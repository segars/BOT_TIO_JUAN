import baileys, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import fs from 'fs'

const { makeWASocket } = baileys

async function connectBot() {
  let { state, saveCreds } = await useMultiFileAuthState('./session')
  let sock
  const userSessions = {}

  const startSock = () => {
    sock = makeWASocket({ auth: state })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      // Mostrar QR siempre en una sola línea
      if (qr && !sock._qrShown) {
        sock._qrShown = true
        console.log('\n===== ESCANEA ESTE QR CON WHATSAPP =====\n')
        console.log(qr) // Versión en línea simple
        console.log('\n========================================\n')
        qrcode.generate(qr, { small: true }) // También versión "bonita"
      }

      if (connection === 'open') {
        console.log('Bot conectado con éxito!')
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode

        if (reason === DisconnectReason.loggedOut) {
          console.log('Sesión cerrada desde el celular. Borrando credenciales y esperando nuevo QR...')
          fs.rmSync('./session', { recursive: true, force: true })

          // Reiniciar estado y reconectar
          const newAuth = await useMultiFileAuthState('./session')
          state = newAuth.state
          saveCreds = newAuth.saveCreds
          sock._qrShown = false
          startSock()
        } else {
          console.log('Reconectando...')
          sock._qrShown = false
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

connectBot()
