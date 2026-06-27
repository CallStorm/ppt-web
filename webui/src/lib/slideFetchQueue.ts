/** Limit concurrent credentialed slide fetches so preview modals don't stampede the API. */
const MAX_CONCURRENT = 4

let inFlight = 0
const waiters: Array<() => void> = []

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      inFlight += 1
      resolve()
    })
  })
}

function release() {
  inFlight = Math.max(0, inFlight - 1)
  const next = waiters.shift()
  if (next) next()
}

export async function withSlideFetchLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
