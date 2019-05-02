const fs = require('fs')
const ytdl = require('ytdl-core')
const path = require('path')
const ffmpeg = require('fluent-ffmpeg')
const youtubedl = require('youtube-dl')
const zipFolder = require('zip-folder')
const exec = require('child_process').exec
const NodeID3 = require('node-id3')

const rp = require('request-promise')
const btoa = require('btoa')
const Koa = require('koa')
const KoaRouter = require('koa-router')
const bodyParser = require('koa-bodyparser')

const app = new Koa()
const router = new KoaRouter()

app.use(bodyParser())
app.use(router.routes()).use(router.allowedMethods())

const { PubSub } = require('@google-cloud/pubsub')

const pubsub = new PubSub('ytdl-playlist-239115')

const topicName = 'projects/ytdl-playlist-239115/topics/download_tasks'

// function getTopic(cb) {
//     pubsub.createTopic(topicName, (err, topic) => {
//         if (err && err.code === 6) {
//             cb(null, pubsub.topic(topicName))
//             return
//         }
//         cb(err, topic)
//     })
// }

// getTopic((err, topic) => {

//     if (err) {
//         console.log(11, err)
//         return
//     }

//     topic.publish(Buffer.from('hiii'), (err) => {
//         if (err) {
//             console.error('Error occurred while queuing background task', err);
//         } else {
//             console.info('sent to queue')
//         }
//     })

// })

// pubsub.topic(topicName).publish(Buffer.from(JSON.stringify({ key: 'value' })), (err) => {
//     if (err) {
//         console.error('Error occurred while queuing background task', err);
//     } else {
//         console.info('sent to queue')
//     }
// })

const queue = {}

let spotifyClientId = '28bc6211497a4a93a51866c234ed3e40'
let spotifyCleintSecret = 'b2bcec9b2d0047b5b83df0d2ee04e688'
let spotifyAccessToken = `BQD0O5fkAZX4SiKqD9qORIf2SHBQ87XQwHR9Ai6zWmTBOzprOpnx9BiaW8_OjyAmdI3sFuLp0G5-7TzPr32MqZYvUCLtpto6Y4-vStNvse-8bkjJsXLJADdE78uHqo5OJn1shjIH280`
let base64Spotify = btoa(`${spotifyClientId}:${spotifyCleintSecret}`)

router.get(`/ping`, ctx => {
    ctx.body = "pong"
})

router.get(`/info`, async ctx => {
    const info = await new Promise((resolve, reject) => {
        ytdl.getInfo(ctx.query.vid, (err, info) => {
            if (err) reject(err)
            // let audioFormats = ytdl.filterFormats(info.formats, 'audioonly')
            resolve(info)
        })
    })
    ctx.body = { formats: info.formats }
    // ctx.body = { formats: info }
})

router.get(`/queue`, ctx => {
    return ctx.body = { task: queue[ctx.query.tid] }
})

router.post(`/task`, ctx => {

    const { url = '' } = ctx.request.body

    if (!url.length)
        return ctx.body = { err: true, msg: 'illegal url' }

    const taskKey = `${Math.floor(Math.random() * 1e15)}_${(new Date().getTime())}`

    const audioOutput = path.resolve(__dirname, `sound_${taskKey}.mp4`)
    const mainOutput = path.resolve(__dirname, `output_${taskKey}.mp4`)

    queue[taskKey] = { status: 'pending' }



    ytdl(url, {
        filter: format => {
            return format.container === 'm4a' && !format.encoding;
        }
    })
        .pipe(fs.createWriteStream(audioOutput))
        .on('info', (info) => {
            console.log(info)
        })
        .on('finish', () => {
            console.log('pipe finished')
            queue[taskKey] = { status: 'download_complete' }
            console.log(queue)
            ffmpeg()
                .input(ytdl(url, {
                    filter: format => {
                        return format.container === 'mp4' && !format.audioEncoding;
                    }
                }))
                .videoCodec('copy')
                .input(audioOutput)
                .audioCodec('copy')
                .save(mainOutput)
                .on('error', console.error)
                .on('progress', progress => {
                    process.stdout.cursorTo(0);
                    process.stdout.clearLine(1);
                    process.stdout.write(progress.timemark);
                    // console.log(progress)
                }).on('end', () => {
                    fs.unlink(audioOutput, err => {
                        if (err) console.error(err);
                        else console.log('\nfinished downloading');
                        queue[taskKey] = { status: 'finished' }
                        console.log(queue)
                    });
                });
        });
    return ctx.body = { taskId: taskKey, status: queue[taskKey] }
})


router.post(`/tasks`, ctx => {

    const { urls = [], format, type } = ctx.request.body

    // if (type !== 'video' || type !== 'audio') {
    //     ctx.body = { err: true, msg: 'invalid type' }
    //     ctx.status = 422
    //     return
    // }

    if (!urls || !urls.length) {
        ctx.body = { err: true, msg: 'illegal url' }
        ctx.status = 422
        return
    }

    if (format === '') {
        ctx.body = { err: true, msg: 'invalid format' }
        ctx.status = 422
        return
    }

    const taskKey = `${Math.floor(Math.random() * 1e15)}_${(new Date().getTime())}`

    const task = {
        taskKey,
        urls,
        format,
        type
    }

    pubsub.topic(topicName).publish(Buffer.from(JSON.stringify(task)), (err) => {
        if (err) {
            console.error('Error occurred while queuing background task', err);
        } else {
            console.info('sent to queue')
        }
    })

    // downloadVideo(urls, taskKey, format)

    // queue[taskKey] = { status: 'initialized', progress: 0 }

    // downloadAudio(urls, taskKey, format)

    return ctx.body = { taskId: taskKey, status: queue[taskKey] }
})

const downloadVideo = async (urls, taskKey, format) => {

    const videoFormats = {
        '360p': {
            itag: '134',
            audioEncoding: 'aac'
        },
        '480p': {
            itag: '135',
            audioEncoding: null
        },
        '720p': {
            itag: '136',
            audioEncoding: null
        },
        '1080p': {
            itag: '137',
            audioEncoding: null
        }
    }

    console.log((videoFormats[format]), urls)

    let downloadDirectory = './downloads'

    if (urls.length > 1) {
        await new Promise((resolve, reject) => {
            fs.mkdir(`./downloads/${taskKey}`, (err) => {
                if (err) {
                    console.log('error creating folder: ', taskKey, err)
                    reject(err)
                } else {
                    console.log('folder: ', taskKey, ' createded successfully')
                    downloadDirectory = `./downloads/${taskKey}`
                    resolve()
                }
            })
        })
    }
    const vidFormat = videoFormats[format] && videoFormats[format].itag || 135

    const videoListDownloads = urls.map((url, i) => {

        const audioOutput = `${downloadDirectory}/${url.title}.m4a`
        return new Promise((resolve, reject) => {

            ytdl(url.link, {
                filter: format => {
                    return format.container === 'm4a' && !format.encoding;
                }
            })
                .pipe(fs.createWriteStream(audioOutput))
                .on('info', (info) => {
                    console.log(info)
                })
                .on('finish', () => {
                    console.log('pipe finished')
                    queue[taskKey] = { status: 'download_complete' }
                    console.log(queue)
                    ffmpeg()
                        .input(
                            ytdl(url.link, {
                                filter: format => {
                                    return format.itag === vidFormat
                                }
                            })
                        )
                        .videoCodec('copy')
                        .input(audioOutput)
                        .audioCodec('copy')
                        .save(`${downloadDirectory}/${url.title}.mp4`)
                        .on('error', console.error)
                        .on('progress', progress => {
                            process.stdout.cursorTo(0)
                            process.stdout.clearLine(1)
                            process.stdout.write(progress.timemark)
                            // console.log(progress)
                        }).on('end', () => {
                            fs.unlink(audioOutput, err => {
                                if (err) {
                                    console.error(err)
                                    reject(err)
                                }
                                else {
                                    console.log('\nfinished downloading')
                                    queue[taskKey] = { status: 'pending', progress: queue[taskKey].progress + 1 }
                                    resolve()
                                }
                            })
                        })
                })

        })
    })


    Promise.all(videoListDownloads)
        .then(() => {

            if (urls.length === 1) {
                queue[taskKey] = { status: 'completed', progress: 100, downloadLink: downloadDirectory }
            } else {
                zipFolder(downloadDirectory, `${downloadDirectory}.zip`, function (err) {
                    if (err) {
                        console.log('error creating zip', err);
                    } else {
                        console.log('created zip successfully!');
                        exec(`rm -Rf ${downloadDirectory}`, function (error) {
                            if (error) {
                                console.log('error deleting directory: ', error)
                            } else {
                                console.log('deleted directory successfully!')
                                queue[taskKey] = { status: 'completed', progress: 100, downloadLink: `${downloadDirectory}.zip` }
                            }
                        })
                    }
                })
            }


        })

}


const downloadAudio = async (urls, taskKey, format) => {

    const audioFormats = {
        webm: {
            itag: 251,
            audioBitrate: 160
        },
        m4a: {
            itag: 140,
            audioBitrate: 128
        },
        mp3: {
            itag: 140,
            audioBitrate: 128
        }
    }

    let downloadDirectory = './downloads'

    if (urls.length > 1) {
        await new Promise((resolve, reject) => {
            fs.mkdir(`./downloads/${taskKey}`, (err) => {
                if (err) {
                    console.log('error creating folder: ', taskKey, err)
                    reject(err)
                } else {
                    console.log('folder: ', taskKey, ' createded successfully')
                    downloadDirectory = `./downloads/${taskKey}`
                    resolve()
                }
            })
        })
    }

    const audioListDownloads = urls.map((url, i) => {
        return new Promise((resolve, reject) => {
            const audio = youtubedl((url.link || url), [`--format=${(audioFormats[format] && audioFormats[format].itag) || 140}`, '--format=bestaudio'])
            return ffmpeg(audio)
                .audioBitrate((audioFormats[format] && audioFormats[format].audioBitrate) || 128)
                .save(`${downloadDirectory}/${url.title}.${audioFormats[format] ? format : 'mp3'}`)
                .on('progress', p => {
                    console.log(`ffmpeg progress for ${url.title}: `, p)
                })
                .on('end', () => {
                    console.log('done')
                    queue[taskKey] = { status: 'pending', progress: queue[taskKey].progress + 1 }
                    resolve()
                })
        })
    })

    Promise.all(audioListDownloads)
        .then(() => {

            if (urls.length === 1) {
                queue[taskKey] = { status: 'completed', progress: 100, downloadLink: downloadDirectory }
            } else {
                zipFolder(downloadDirectory, `${downloadDirectory}.zip`, function (err) {
                    if (err) {
                        console.log('error creating zip', err);
                    } else {
                        console.log('created zip successfully!');
                        exec(`rm -Rf ${downloadDirectory}`, function (error) {
                            if (error) {
                                console.log('error deleting directory: ', error)
                            } else {
                                console.log('deleted directory successfully!')
                                queue[taskKey] = { status: 'completed', progress: 100, downloadLink: `${downloadDirectory}.zip` }
                            }
                        })
                    }
                })
            }

        })

}

const titleFilters = ['lyrics', 'lyric', 'by', 'video', 'official', 'hd', 'dirty', 'with', 'lyrics', 'feat', 'original', 'remix',
    'www', 'com', 'mp3', 'audio', 'remixed', 'mix', 'full', 'version', 'music', 'hq', 'uploaded', 'explicit', '(', ')', ',', '_', '-', '.']


const setMetaInfo = (folder, trackName) => {
    return fs.readdir(folder, (err, files) => {

        const metaPromises = files.map(file => {

            // let clearedFileTitle = file.replace(/\s{2,}/g, ' ').split('.').slice(0, -1).join('.').toLowerCase()

            let clearedFileTitle = file.toLowerCase()

            titleFilters.forEach(f => {
                clearedFileTitle = clearedFileTitle.replace(f, '')
            })
            clearedFileTitle = clearedFileTitle.replace(/\s{2,}/g, ' ')
            console.log(clearedFileTitle)
            return getMetaInfo(clearedFileTitle)
                .then(response => {
                    if (response.tracks.items.length === 0) {
                        return true
                    }

                    const firstTrackItem = response.tracks.items[0]

                    const options = {
                        uri: firstTrackItem.album.images[0].url,
                        encoding: null
                    }

                    return rp(options)
                        .then(body => {
                            console.log('got body')
                            const data = {
                                artist: firstTrackItem.album.artists[0].name,
                                album: firstTrackItem.album.name,
                                title: clearedFileTitle,
                                APIC: body
                            }
                            NodeID3.update(data, `${folder}/${file}`, function (err, buffer) {
                                if (err) {
                                    console.log(11, err)
                                    return err
                                }
                                return true
                            })
                        })


                })

        })

        return Promise.all(metaPromises)
            .then(response => {
                console.log('done')
            })
            .catch(err => {
                console.log(err)
            })

    })
}


const getMetaInfo = trackName => {
    const options = {
        uri: `https://api.spotify.com/v1/search?q=${trackName}&type=track&limit=5`,
        headers: {
            'Authorization': `Bearer ${spotifyAccessToken}`
        },
        json: true
    }

    return rp(options)
        .then(response => response)
        .catch(err => {
            if (err && err.statusCode === 401) {
                return getSpotifyToken()
                    .then(() => getMetaInfo(trackName))
            }
        })
}

const getSpotifyToken = () => {
    const options = {
        method: 'POST',
        uri: `https://accounts.spotify.com/api/token`,
        form: {
            'grant_type': 'client_credentials'
        },
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${base64Spotify}`
        },
        json: true
    }
    return rp(options)
        .then(response => {
            spotifyAccessToken = response.access_token
        })
        .catch(err => {
            console.log('spotify auth error: ', err)
        })
}


app.listen(3003, () => {
    console.log('server running on port 3003')
})


