interface StudentContext {
  full_name: string
  current_day: number
  risk_level: 'green' | 'yellow' | 'red'
}

// Uses the plain REST API (no `openai` SDK dependency) to stay consistent
// with how elevenlabs.ts and meta-whatsapp.ts call their providers.
export async function generateFollowUpMessage(student: StudentContext): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing in environment variables.')
  }

  const prompt = `Eres Mane, una experta en Yoga Facial. Estás haciendo un seguimiento a tu alumna ${student.full_name}.
Hoy es el día ${student.current_day} de su programa.
Su nivel de riesgo es ${student.risk_level} (si es rojo, dale mucho ánimo y pregúntale por qué no ha podido avanzar; si es verde, felicítala).
Escribe un mensaje de WhatsApp corto, amigable, usando emojis, y con tu tono característico.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are Mane, an expert in facial yoga who speaks in a warm, motivating, and friendly Spanish tone.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 150,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('OpenAI error:', errorText)
    throw new Error('Failed to generate message')
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || 'Hola bella, ¿cómo vas con tu rutina hoy?'
}
