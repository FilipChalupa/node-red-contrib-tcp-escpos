import * as NodeRED from 'node-red'
import net from 'node:net'
import { URL } from 'node:url'

const connectTcp = (options: net.NetConnectOpts) =>
	new Promise<net.Socket>((resolve, reject) => {
		const socket = net.createConnection(options)
		socket.once('connect', () => resolve(socket))
		socket.once('error', (error) => reject(error))
	})

const allowedTypes = ['text', 'image', 'buffer'] as const
type Type = (typeof allowedTypes)[number]

interface TcpEscposNodeConfiguration extends NodeRED.NodeDef {
	host: string
	type: Type
	payload: string | Array<number>
}

export = function (RED: NodeRED.NodeAPI) {
	function TcpEscposNode(
		this: NodeRED.Node,
		configuration: TcpEscposNodeConfiguration,
	) {
		RED.nodes.createNode(this, configuration)

		this.on('close', () => {
			this.status({})
		})

		this.on('input', async (message: any, _send, done) => {
			const error = await (async () => {
				try {
					const payload = (() => {
						const type =
							allowedTypes.find((type) => type === message.type) ||
							configuration.type
						const payload = message.payload || configuration.payload
						if (type === 'text') {
							throw new Error('Text type not implemented yet')
						}
						if (type === 'image') {
							throw new Error('Image type not implemented yet')
						}
						if (type === 'buffer') {
							if (Array.isArray(payload)) {
								return Buffer.from(payload)
							}
							return Buffer.from(payload, 'base64')
						}
						return type satisfies never
					})()
					this.status({ fill: 'yellow', shape: 'dot', text: 'connecting…' })
					const hostname: string = message.host || configuration.host
					if (!hostname) {
						throw new Error('Host is not defined')
					}
					const url = new URL(`tcp://${hostname}`)
					const { hostname: host } = url
					const port = Number(url.port) || 9100

					const socket = await connectTcp({ host, port })

					this.status({ fill: 'yellow', shape: 'dot', text: 'sending…' })
					await new Promise<void>((resolve, reject) => {
						socket.write(payload, (error) => {
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
				} catch (error) {
					if (error instanceof Error) {
						return error
					}
				}
				return undefined
			})()
			if (error) {
				this.status({ fill: 'red', shape: 'dot', text: 'failed' })
				this.error(error.message, message)
			} else {
				this.status({ fill: 'green', shape: 'dot', text: 'sent' })
			}
			done?.(error)
		})
	}

	RED.nodes.registerType('tcp escpos', TcpEscposNode)
}
