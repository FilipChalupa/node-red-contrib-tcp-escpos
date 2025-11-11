import iconv from 'iconv-lite'
import * as NodeRED from 'node-red'
import net from 'node:net'
import { URL } from 'node:url'

const connectTcp = (options: net.NetConnectOpts) =>
	new Promise<net.Socket>((resolve, reject) => {
		const socket = net.createConnection(options)
		socket.once('connect', () => resolve(socket))
		socket.once('error', (error) => reject(error))
	})

const encodeText = (text: string): Buffer => {
	// Remove all characters that are not letters, numbers, punctuation or whitespace printers cannot handle emojis
	const filtered = text.replaceAll(/[^\p{L}\p{N}\p{P}\p{Z}\n\r×]+/gu, '')
	return iconv.encode(filtered, 'CP852')
}

const allowedPayloadTypes = ['text', 'image', 'buffer'] as const
type PayloadType = (typeof allowedPayloadTypes)[number]

interface TcpEscposNodeConfiguration extends NodeRED.NodeDef {
	host: string
	payloadType: PayloadType
	payload: string | Array<number>
	cutAfter: boolean
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
						const payloadType =
							allowedPayloadTypes.find((type) => type === message.type) ||
							configuration.payloadType
						const payload = message.payload || configuration.payload
						const cutAfter = message.cutAfter ?? configuration.cutAfter
						if (payloadType === 'text') {
							const commands: Array<Buffer> = []
							commands.push(Buffer.from([0x1b, 0x40])) // Initialize printer
							commands.push(Buffer.from([0x1b, 0x74, 18])) // Language options: 18 is CP852 code table
							commands.push(Buffer.from([0x1b, 0x61, 1])) // Center alignment
							commands.push(encodeText(String(payload)))
							commands.push(Buffer.from([0x0a])) // New line
							if (cutAfter) {
								commands.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a])) // New lines
								commands.push(Buffer.from([0x1b, 0x69])) // Cut
							}

							return Buffer.concat(commands)
						}
						if (payloadType === 'image') {
							throw new Error('Image type not implemented yet')
						}
						if (payloadType === 'buffer') {
							if (Array.isArray(payload)) {
								return Buffer.from(payload)
							}
							return Buffer.from(payload, 'base64')
						}
						return payloadType satisfies never
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
