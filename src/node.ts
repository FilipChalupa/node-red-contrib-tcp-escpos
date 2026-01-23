import iconv from 'iconv-lite'
import * as NodeRED from 'node-red'
import fs from 'node:fs/promises'
import net from 'node:net'
import { URL } from 'node:url'
import { Canvas, loadImage } from 'skia-canvas'
import { dither } from './utilities/dither'

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
					const cutAfter = message.cutAfter ?? configuration.cutAfter
					const payload = await (async () => {
						const payloadType =
							allowedPayloadTypes.find((type) => type === message.type) ||
							configuration.payloadType
						const payload = message.payload || configuration.payload
						if (payloadType === 'text') {
							const commands: Array<Buffer> = []
							commands.push(Buffer.from([0x1b, 0x40])) // Initialize printer
							commands.push(Buffer.from([0x1b, 0x74, 18])) // Language options: 18 is CP852 code table
							commands.push(Buffer.from([0x1b, 0x61, 1])) // Center alignment
							commands.push(encodeText(String(payload)))
							commands.push(Buffer.from([0x0a])) // New line
							return Buffer.concat(commands)
						}
						if (payloadType === 'image') {
							const imageBuffer = await (async () => {
								if (Buffer.isBuffer(payload)) {
									return payload
								}
								if (typeof payload === 'string') {
									if (payload.startsWith('data:image/')) {
										const base64 = payload.split(',', 2)[1]
										return Buffer.from(base64, 'base64')
									}
									try {
										const url = new URL(payload)
										if (
											url.protocol === 'http:' ||
											url.protocol === 'https:' ||
											url.protocol === 'file:'
										) {
											const response = await fetch(url.toString())
											return Buffer.from(await response.arrayBuffer())
										}
									} catch {}
									const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/
									if (payload.length % 4 === 0 && base64Pattern.test(payload)) {
										return Buffer.from(payload, 'base64')
									}
									const isFilePath = await (async () => {
										try {
											await fs.access(payload)
											return true
										} catch {}
										return false
									})()
									if (isFilePath) {
										return fs.readFile(payload)
									}
								}
								throw new Error('Invalid image payload.')
							})()
							const image = await loadImage(imageBuffer)
							// @TODO: scale down too wide images to fit the paper width
							const canvas = new Canvas(image.width, image.height)
							const context = canvas.getContext('2d')
							context.drawImage(image, 0, 0, canvas.width, canvas.height)
							dither(canvas)
							const payloadParts: Array<Buffer> = []
							payloadParts.push(Buffer.from([0x1b, 0x40])) // Initialize printer
							payloadParts.push(Buffer.from([0x1b, 0x61, 1])) // Center alignment
							const splitImageByHeightInPixels = 1024 // Splitting image to more smaller ones because Epson printer can't handle one super heigh image
							for (
								let yOffset = 0;
								yOffset < canvas.height;
								yOffset += splitImageByHeightInPixels
							) {
								const chunkHeight = Math.min(
									splitImageByHeightInPixels,
									canvas.height - yOffset,
								)
								const {
									width,
									height,
									data: imageData,
								} = context.getImageData(0, yOffset, canvas.width, chunkHeight)
								const bytes = (width + 7) >> 3
								// For xL, xH, yL, yH, see the documentation https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html
								const xL = bytes & 0xff
								const xH = bytes >> 8
								const yL = height & 0xff
								const yH = height >> 8
								const pixelsGroupedToBytes = Buffer.alloc(bytes * height)
								for (let y = 0; y < height; y++) {
									for (let x = 0; x < width; x++) {
										const index = (y * width + x) * 4
										const red = imageData[index]
										const green = imageData[index + 1]
										const blue = imageData[index + 2]
										const alpha = imageData[index + 3]
										const greyscale = red * 0.299 + green * 0.587 + blue * 0.114
										if (alpha > 127 && greyscale < 128) {
											const byteIndex = y * bytes + (x >> 3)
											const bit = 1 << (7 - (x & 7))
											pixelsGroupedToBytes[byteIndex] |= bit
										}
									}
								}
								payloadParts.push(
									Buffer.from([0x1d, 0x76, 0x30, 0, xL, xH, yL, yH]),
								)
								payloadParts.push(pixelsGroupedToBytes)
							}
							return Buffer.concat(payloadParts)
						}
						if (payloadType === 'buffer') {
							if (Buffer.isBuffer(payload)) {
								return payload
							}
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
						const commands = Buffer.concat([
							payload,
							...(cutAfter
								? [
										Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]), // New lines
										Buffer.from([0x1b, 0x69]), // Cut
									]
								: []),
						])
						socket.write(commands, (error) => {
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
