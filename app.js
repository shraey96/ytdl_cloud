const fs = require('fs')
const ytdl = require('ytdl-core')
const path = require('path')
const ffmpeg = require('fluent-ffmpeg')
const youtubedl = require('youtube-dl')
const zipFolder = require('zip-folder')
const exec = require('child_process').exec
const NodeID3 = require('node-id3')
const request = require('request')
const rp = require('request-promise')
const btoa = require('btoa')
const Koa = require('koa')
const KoaRouter = require('koa-router')
const bodyParser = require('koa-bodyparser')

const app = new Koa()
const router = new KoaRouter()

app.use(bodyParser())
app.use(router.routes()).use(router.allowedMethods())

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
    })// Write audio to file since ffmpeg supports only one input stream.
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

    const { urls = [], format } = ctx.request.body

    if (!urls || !urls.length)
        return ctx.body = { err: true, msg: 'illegal url' }

    const taskKey = `${Math.floor(Math.random() * 1e15)}_${(new Date().getTime())}`

    // downloadVideo(urls[0], taskKey, format)

    queue[taskKey] = { status: 'initialized', progress: 0 }

    downloadAudio(urls, taskKey, format)

    return ctx.body = { taskId: taskKey, status: queue[taskKey] }
})

const downloadVideo = (url, taskKey, format) => {

    const videoFormats = {
        '360p': {
            itag: 134,
            audioEncoding: 'aac'
        },
        '480p': {
            itag: 135,
            audioEncoding: null
        },
        '720p': {
            itag: 136,
            audioEncoding: null
        },
        '1080p': {
            itag: 137,
            audioEncoding: null
        }
    }

    console.log((videoFormats[format]), url)

    let downloadDirectory = './downloads'

    const audioOutput = path.resolve(__dirname, `sound_${taskKey}.m4a`)
    const mainOutput = path.resolve(__dirname, `output_${taskKey}.mp4`)

    const audio = youtubedl(url, [`--format=m4a/webm`])
        .pipe(fs.createWriteStream(audioOutput))
    audio.on('end', () => {
        console.log('ended dl')
        ffmpeg()
            .input(youtubedl(url, [`--format=${(videoFormats[format] && videoFormats[format].itag) || 135}`, '--format=bestvideo']))
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
                console.log('ended ffmpeg')
                fs.unlink(audioOutput, err => {
                    if (err) console.error(err);
                    else console.log('\nfinished downloading');
                    queue[taskKey] = { status: 'finished' }
                    console.log(queue)
                })
            })
    })

    // const video = youtubedl(url, [`--format=${(videoFormats[format] && videoFormats[format].itag) || 135}`, '--format=bestvideo'])

    // fs.mkdir(`./downloads/${taskKey}`, (err) => {
    //     if (err) {
    //         console.log('error creating folder: ', taskKey, err)
    //     } else {
    //         console.log('folder: ', taskKey, ' createded successfully')
    //     }

    // })

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
                    console.log('ffmpeg progress: ', p)
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


const testFolder = './downloads'

const titleFilters = ['lyrics', 'lyric', 'by', 'video', 'official', 'hd', 'dirty', 'with', 'lyrics', 'feat', 'original', 'mix',
    'www', 'com', 'mp3', 'audio', 'remixed', 'remix', 'full', 'version', 'music', 'hq', 'uploaded', 'explicit']

// id3 node 
fs.readdir(testFolder, (err, files) => {
    files.forEach(file => {

        let clearedFile = file

        titleFilters.forEach(f => {
            clearedFile.replace(f, '')
        })

        clearedFile = clearedFile.replace(/\s{2,}/g, ' ')
        console.log(clearedFile)
        const fileWithoutExt = (clearedFile.split('.').slice(0, -1).join('.'))

        const uri = `https://images.unsplash.com/photo-1555298472-8c43a95ddb8f?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=400&h=400&q=80`

        // request({ uri, encoding: null }, (err, response, body) => {
        //     const data = {
        //         artist: file,
        //         title: fileWithoutExt,
        //         APIC: body
        //     }
        //     NodeID3.update(data, `${testFolder}/${file}`, function (err, buffer) {
        //         if (err) {
        //             console.log(11, err)
        //         } else {
        //             console.log('done')
        //         }
        //     })
        // })

    })
})





const getMetaInfo = trackName => {
    const options = {
        uri: `https://api.spotify.com/v1/search?q=${trackName}&type=track&limit=5`,
        headers: {
            'Authorization': `Bearer ${spotifyAccessToken}`
        }
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
        }
    }
    return rp(options)
        .then(response => {
            spotifyAccessToken = JSON.parse(response).access_token
        })
        .catch(err => {
            console.log('spotify auth error: ', err)
        })
}

getMetaInfo(`Don't let me down`)
    .then(response => console.log(response))

app.listen(3003, () => {
    console.log('server running on port 3003')
})


