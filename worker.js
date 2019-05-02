const { PubSub } = require('@google-cloud/pubsub')

const pubsub = new PubSub('ytdl-playlist-239115')

const subscriptionName = 'projects/ytdl-playlist-239115/subscriptions/download_tasks_subscription'

const subscription = pubsub.subscription(subscriptionName)


const messageHandler = message => {
    console.log(`Received message ${message.id}:`)
    console.log(`\tData: ${message.data}`)
    console.log(`\tAttributes: ${message.attributes}`)

    message.ack()
}

const errorHandler = error => {
    // Do something with the error
    console.error(`ERROR: ${error}`)
}

subscription.on(`message`, messageHandler)
subscription.on(`error`, errorHandler)