import net from 'node:net'

const sockets = new Map<string, net.Socket>()
const timeouts = new Map<string, NodeJS.Timeout>()
const keepOpenAfterWriteMilliseconds = 100

const connectTcp = (options: net.NetConnectOpts) =>
	new Promise<net.Socket>((resolve, reject) => {
		const socket = net.createConnection(options)
		socket.once('connect', () => resolve(socket))
		socket.once('error', (error) => reject(error))
	})

const clearTimeout = (key: string) => {
	const timeout = timeouts.get(key)
	if (timeout) {
		globalThis.clearTimeout(timeout)
		timeouts.delete(key)
	}
}

export const socketWrite = async (
	host: string,
	port: number,
	buffer: Uint8Array,
) => {
	const key = `${host}:${port}`
	let socket = sockets.get(key)

	if (socket?.destroyed || socket?.writableEnded) {
		socket = undefined
		sockets.delete(key)
	}

	if (!socket) {
		socket = await connectTcp({ host, port })
		sockets.set(key, socket)

		socket.on('close', () => {
			sockets.delete(key)
			clearTimeout(key)
		})

		socket.on('error', (error) => {
			console.error('Socket error:', error)
			sockets.delete(key)
			clearTimeout(key)
		})
	}

	await new Promise<void>((resolve, reject) => {
		socket.write(buffer, (error) => {
			if (error) {
				reject(error)
			} else {
				resolve()
			}
		})
	})

	// Clear previous timeout
	clearTimeout(key)

	// Set a new timeout to close the socket
	timeouts.set(
		key,
		setTimeout(() => {
			if (socket) {
				socket.end()
			}
			timeouts.delete(key)
		}, keepOpenAfterWriteMilliseconds),
	)
}
