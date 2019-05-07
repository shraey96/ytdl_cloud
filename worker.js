const fs = require('fs')
const ytdl = require('ytdl-core')
const ffmpeg = require('fluent-ffmpeg')
const youtubedl = require('youtube-dl')
const zipFolder = require('zip-folder')
const exec = require('child_process').exec
const { PubSub } = require('@google-cloud/pubsub')

const pubsub = new PubSub()

const subscriptionName = 'projects/ytdl-playlist-239115/subscriptions/download_tasks_subscription'

const subscription = pubsub.subscription(subscriptionName)

console.log('WORKER 1')

const messageHandler = message => {

    console.log(`Received message ${message.id}:`)
    console.log(`\tData: ${message.data}`)
    // console.log(`\tAttributes: ${message.attributes}`)

    const data = (JSON.parse(message.data))

    // downloadVideo(data.urls, data.taskKey, data.format)

    // downloadAudio(data.urls, data.taskKey, data.format)
    exec(`youtube-dl --rm-cache-dir`, error => {
        if (error) {
            console.log('cache cleared failed', error)
        } else {
            console.log('cache cleared successfull')
            downloadVideoCLI(data.urls, data.taskKey, data.format)
        }
    })
    // downloadVideoCLI(data.urls, data.taskKey, data.format)

    message.ack()
}


const errorHandler = error => {
    console.error(`ERROR: ${error}`)
}



// Youtube-dl cli function //


const downloadVideoCLI = async (urls, taskKey, format) => {

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

    const vidFormat = videoFormats[format] && videoFormats[format].itag || 135

    let downloadDirectory = 'downloads'

    if (urls.length > 1) {
        await new Promise((resolve, reject) => {
            fs.mkdir(`./downloads/${taskKey}`, (err) => {
                if (err) {
                    console.log('error creating folder: ', taskKey, err)
                    reject(err)
                } else {
                    console.log('folder: ', taskKey, ' createded successfully')
                    downloadDirectory = `downloads/${taskKey}`
                    resolve()
                }
            })
        })
    }


    const cliYTPromises = urls.map(url => {
        return new Promise((resolve, reject) => {
            // -o ${__dirname}/${downloadDirectory}/%(${url.title})s.%(mp4)s
            // const ytdlQuery = `youtube-dl -f ${vidFormat}/bestvideo+140/bestaudio ${url.link}`
            const ytdlQuery = `youtube-dl -f ${vidFormat}+140/bestaudio ${url.link}`

            const childProc = exec(ytdlQuery, (error, stdout, stderr) => {
                if (error) {
                    console.log('@@@ download failed: ', error)
                    childProc.kill()
                    reject(error)
                } else {
                    console.log('@@@ download success')
                    childProc.kill()
                    resolve()
                }
            })

        })
    })

    Promise.all(cliYTPromises)
        .then(() => {
            console.log('@@@ complete @@@')
        })
        .catch(err => {
            console.log(`@@@ ERROR @@@: `, err)
        })
}



// FFMPEG FUNCTIONS //

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
                    console.log('folder: ', taskKey, ' created successfully')
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

    await Promise.all(audioListDownloads)

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

}


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

            try {
                ytdl(url.link, {
                    filter: format => {
                        return format.container === 'm4a' && !format.encoding;
                    }
                })
                    .pipe(fs.createWriteStream(audioOutput))
                    .on('error', (e) => reject(e))
                    .on('info', (info) => {
                        console.log(info)
                    })
                    .on('finish', () => {
                        console.log('pipe finished')
                        // queue[taskKey] = { status: 'download_complete' }
                        // console.log(queue)
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
                                        // queue[taskKey] = { status: 'pending', progress: queue[taskKey].progress + 1 }
                                        resolve()
                                    }
                                })
                            })
                    })
            }
            catch (e) {
                console.log('ytdl-err', err)
            }



        })
    })

    await Promise.all(videoListDownloads)

    if (urls.length === 1) {
        // queue[taskKey] = { status: 'completed', progress: 100, downloadLink: downloadDirectory }
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
                        // queue[taskKey] = { status: 'completed', progress: 100, downloadLink: `${downloadDirectory}.zip` }
                    }
                })
            }
        })
    }
}

subscription.on(`message`, messageHandler)
subscription.on(`error`, errorHandler)