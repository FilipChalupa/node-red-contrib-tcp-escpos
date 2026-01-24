import net from 'node:net'

const connectTcp = (options: net.NetConnectOpts) =>
	new Promise<net.Socket>((resolve, reject) => {
		const socket = net.createConnection(options)
		socket.once('connect', () => resolve(socket))
		socket.once('error', (error) => reject(error))
	})

export const socketWrite = async (
	host: string,
	port: number,
	buffer: Uint8Array,
) => {
	const socket = await connectTcp({ host, port })

	await new Promise<void>((resolve, reject) => {
		socket.write(buffer, (error) => {
			if (error) {
				reject(error)
			} else {
				resolve()
			}
		})
	})

	await new Promise<void>((resolve) => {
		socket.end(resolve)
	})

	await new Promise((resolve) => setTimeout(resolve, 200)) // Wait a bit so the printer can clean buffer a to make sure next immediate print task comes in right order.
}
