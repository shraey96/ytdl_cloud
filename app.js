const fs = require('fs')
const ytdl = require('ytdl-core')
const path = require('path')
const ffmpeg = require('fluent-ffmpeg')
const youtubedl = require('youtube-dl')
const zipFolder = require('zip-folder')
const exec = require('child_process').exec
const NodeID3 = require('node-id3')
const rp = require('request-promise');

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


// const testFolder = './downloads/'

// // id3 node 
// fs.readdir(testFolder, (err, files) => {
//     files.forEach(file => {
//         console.log(file)
//         const fileWithoutExt = (file.split('.').slice(0, -1).join('.'))

//         var options = {
//             uri: `https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=200&q=80`,
//         }

//         rp(options)
//             .then(function (imageBuffer) {
//                 console.log('got')
//                 const data = {
//                     artist: file,
//                     title: fileWithoutExt,
//                     APIC: `${testFolder}/a.jpg`
//                 }
//                 NodeID3.update(data, `${testFolder}/${file}`, function (err, buffer) {
//                     if (err) {
//                         console.log(11, err)
//                     } else {
//                         console.log('done')
//                     }
//                     NodeID3.read(`${testFolder}/${file}`, function (err, tags) {
//                         console.log(111, err)
//                         console.log(111, tags)
//                     })
//                 })
//             })
//             .catch(function (err) {
//                 // API call failed...
//             });


//     })
// })


app.listen(3003, () => {
    console.log('server running on port 3003')
})


