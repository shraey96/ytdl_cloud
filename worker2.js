const { PubSub } = require('@google-cloud/pubsub')

const pubsub = new PubSub('ytdl-playlist-239115')

const topicName = 'projects/ytdl-playlist-239115/topics/download_tasks'

const topic = pubsub.topic(topicName);

const options = {
  interval: 5000
}

const subscriptionName = 'projects/ytdl-playlist-239115/subscriptions/download_tasks_subscription'

const subscription = pubsub.subscription(subscriptionName, options)

console.log('WORKER 2')

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

// setInterval(() => {
//   subscription.removeListener('message', messageHandler)
//   subscription.on(`message`, messageHandler)
//   console.log(99)
// await client.pull(request)
// }, 3000)
