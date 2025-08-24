import baileys, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import fs from 'fs'
import express from 'express'
import qrcode from 'qrcode'

const { makeWASocket } = baileys
const app = express()
let qrImage = null

async function connectBot() {
  let { state, saveCreds } = await useMultiFileAuthState('./session')
  let sock
  const userSessions = {}

  const startSock = () => {
    sock = makeWASocket({ auth: state, printQRInTerminal: false })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        qrImage = await qrcode.toDataURL(qr) // Guardamos QR en base64
        console.log('QR listo, visita /qr en el navegador')
      }

      if (connection === 'open') {
        console.log('Bot conectado con éxito!')
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode

        if (reason === DisconnectReason.loggedOut) {
          console.log('Sesión cerrada desde el celular. Borrando credenciales...')
          fs.rmSync('./session', { recursive: true, force: true })

          const newAuth = await useMultiFileAuthState('./session')
          state = newAuth.state
          saveCreds = newAuth.saveCreds
          startSock()
        } else {
          console.log('Reconectando...')
          startSock()
        }
      }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0]
      if (msg.key.fromMe) return

      const from = msg.key.remoteJid
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
      if (!text) return

      if (!userSessions[from]) {
        userSessions[from] = { step: 0, data: {} }
        await sock.sendMessage(from, {
          text: `¡Bienvenido a Wilson Pérez Estudio de Tatuajes! ✨\nGracias por visitarnos, en un momento estaremos contigo.\nCuéntanos, ¿cómo podemos ayudarte hoy?`
        })
        return
      }

      const session = userSessions[from]

      switch (session.step) {
        case 0:
          session.data.consulta = text
          session.step++
          await sock.sendMessage(from, { text: '¡Perfecto! Ahora, por favor dime tu nombre:' })
          break
        case 1:
          session.data.nombre = text
          session.step++
          await sock.sendMessage(from, { text: '¿Qué día y hora deseas tu cita?' })
          break
        case 2:
          session.data.fechaHora = text
          session.step++
          await sock.sendMessage(from, {
            text: `Perfecto, ${session.data.nombre}. Entonces tu solicitud es: "${session.data.consulta}" para ${session.data.fechaHora}.\n¿Es correcta la información? (sí/no)`
          })
          break
        case 3:
          if (text.toLowerCase() === 'sí' || text.toLowerCase() === 'si') {
            await sock.sendMessage(from, { text: '¡Gracias! Hemos registrado tu solicitud. Nos pondremos en contacto contigo pronto ✨' })
            delete userSessions[from]
          } else {
            await sock.sendMessage(from, { text: 'Entendido, reiniciemos el proceso. Cuéntanos, ¿cómo podemos ayudarte hoy?' })
            userSessions[from] = { step: 0, data: {} }
          }
          break
      }
    })
  }

  startSock()
}

app.get('/qr', (req, res) => {
  if (qrImage) {
    res.send(`<h2>Escanea este código QR con WhatsApp:</h2><img src="${qrImage}" />`)
  } else {
    res.send('No hay QR disponible o el bot ya está conectado.')
  }
})

app.listen(3000, () => console.log('Servidor web activo en puerto 3000'))

connectBot()
