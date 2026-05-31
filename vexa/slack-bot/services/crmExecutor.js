const Anthropic = require('@anthropic-ai/sdk')
const config = require('../config')
const db = require('../db')

const client = new Anthropic({ apiKey: config.anthropic.apiKey })

const CRM_TOOLS = [
  {
    name: 'search_deals',
    description: 'Search for deals in HubSpot by company name, deal name, or stage',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — company name, deal name, or keyword' },
        stage: { type: 'string', description: 'Filter by deal stage (optional)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_deal_stage',
    description: 'Update the pipeline stage of a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        stage: {
          type: 'string',
          description: 'New stage. Valid values: appointmentscheduled, qualifiedtobuy, presentationscheduled, decisionmakerboughtin, contractsent, closedwon, closedlost',
        },
      },
      required: ['deal_id', 'stage'],
    },
  },
  {
    name: 'add_note_to_deal',
    description: 'Add a meeting note or comment to a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        note: { type: 'string', description: 'Note content to add' },
      },
      required: ['deal_id', 'note'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact in HubSpot',
    input_schema: {
      type: 'object',
      properties: {
        firstname: { type: 'string' },
        lastname: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        jobtitle: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['firstname'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search for contacts by name, email, or company',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, email, or company to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_deal',
    description: 'Create a new deal in HubSpot',
    input_schema: {
      type: 'object',
      properties: {
        dealname: { type: 'string', description: 'Deal name' },
        amount: { type: 'number', description: 'Deal value in currency' },
        stage: { type: 'string', description: 'Initial pipeline stage' },
        company_name: { type: 'string', description: 'Company name to associate with' },
        closedate: { type: 'string', description: 'Expected close date in YYYY-MM-DD format' },
      },
      required: ['dealname'],
    },
  },
  {
    name: 'update_deal_score',
    description: 'Update the priority or score property of a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        score: { type: 'number', description: 'Score value 0-100' },
      },
      required: ['deal_id', 'score'],
    },
  },
  {
    name: 'log_meeting',
    description: 'Log a completed meeting activity on a deal',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'HubSpot deal ID' },
        meeting_title: { type: 'string', description: 'Meeting title or subject' },
        meeting_notes: { type: 'string', description: 'Meeting notes and outcomes' },
        meeting_date: { type: 'string', description: 'Meeting date in ISO format' },
      },
      required: ['deal_id', 'meeting_title'],
    },
  },
  {
    name: 'list_deals',
    description: 'List deals, optionally filtered by stage or owner',
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Filter by stage (optional)' },
        limit: { type: 'number', description: 'Max results, default 10' },
      },
    },
  },
  {
    name: 'respond_to_user',
    description: 'Send a response message to the user when no API call is needed, or after completing an action',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send to the user in Turkish' },
        success: { type: 'boolean', description: 'Whether the operation succeeded' },
      },
      required: ['message'],
    },
  },
]

async function executeHubSpotTool(toolName, toolInput, accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  const base = 'https://api.hubapi.com'

  switch (toolName) {
    case 'search_deals': {
      const res = await fetch(`${base}/crm/v3/objects/deals/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [],
          query: toolInput.query,
          properties: ['dealname', 'dealstage', 'amount', 'closedate', 'hubspot_owner_id'],
          limit: 10,
        }),
      })
      const data = await res.json()
      return data.results || []
    }

    case 'update_deal_stage': {
      const res = await fetch(`${base}/crm/v3/objects/deals/${toolInput.deal_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: { dealstage: toolInput.stage } }),
      })
      return await res.json()
    }

    case 'add_note_to_deal': {
      const noteRes = await fetch(`${base}/crm/v3/objects/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_note_body: toolInput.note,
            hs_timestamp: new Date().toISOString(),
          },
        }),
      })
      const note = await noteRes.json()

      await fetch(`${base}/crm/v3/associations/notes/deals/batch/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inputs: [{
            from: { id: note.id },
            to: { id: toolInput.deal_id },
            type: 'note_to_deal',
          }],
        }),
      })
      return note
    }

    case 'create_contact': {
      const res = await fetch(`${base}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ properties: toolInput }),
      })
      return await res.json()
    }

    case 'search_contacts': {
      const res = await fetch(`${base}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: toolInput.query,
          properties: ['firstname', 'lastname', 'email', 'company', 'jobtitle'],
          limit: 10,
        }),
      })
      const data = await res.json()
      return data.results || []
    }

    case 'create_deal': {
      const res = await fetch(`${base}/crm/v3/objects/deals`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            dealname: toolInput.dealname,
            amount: toolInput.amount,
            dealstage: toolInput.stage || 'appointmentscheduled',
            closedate: toolInput.closedate,
          },
        }),
      })
      return await res.json()
    }

    case 'update_deal_score': {
      const res = await fetch(`${base}/crm/v3/objects/deals/${toolInput.deal_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          properties: {
            hs_priority: toolInput.score > 66 ? 'high' : toolInput.score > 33 ? 'medium' : 'low',
          },
        }),
      })
      return await res.json()
    }

    case 'log_meeting': {
      const res = await fetch(`${base}/crm/v3/objects/meetings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_meeting_title: toolInput.meeting_title,
            hs_meeting_body: toolInput.meeting_notes || '',
            hs_timestamp: toolInput.meeting_date || new Date().toISOString(),
            hs_meeting_outcome: 'COMPLETED',
          },
        }),
      })
      const meeting = await res.json()

      if (meeting.id) {
        await fetch(`${base}/crm/v3/associations/meetings/deals/batch/create`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            inputs: [{
              from: { id: meeting.id },
              to: { id: toolInput.deal_id },
              type: 'meeting_to_deal',
            }],
          }),
        })
      }
      return meeting
    }

    case 'list_deals': {
      const res = await fetch(
        `${base}/crm/v3/objects/deals?limit=${toolInput.limit || 10}&properties=dealname,dealstage,amount,closedate`,
        { headers }
      )
      const data = await res.json()
      return data.results || []
    }

    case 'respond_to_user':
      return { message: toolInput.message, success: toolInput.success !== false }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

async function executeCrmCommand(slackUserId, userCommand, recentMeetingContext = '') {
  const installation = await db.getCrmInstallation(slackUserId)
  if (!installation) {
    return { success: false, message: 'HubSpot bağlı değil. `/ashera crm bağla` komutunu deneyin.' }
  }

  const systemPrompt = `Sen Ashera'sın, bir satış asistanı. Kullanıcının Türkçe CRM komutlarını HubSpot API işlemlerine çeviriyorsun.

Görevin:
1. Kullanıcının ne yapmak istediğini anla
2. Uygun HubSpot araçlarını çağır
3. İşlemi tamamla
4. Sonucu Türkçe olarak kullanıcıya bildir (respond_to_user ile)

Eğer bir deal bulmadan önce stage güncelleme gibi bir işlem yapılacaksa, önce search_deals ile doğru deal'ı bul.
Eğer kullanıcı "son toplantıyı kaydet" diyorsa, aşağıdaki toplantı bağlamını kullan.
Tüm yanıtları Türkçe yaz.

${recentMeetingContext ? `Son toplantı bağlamı:\n${recentMeetingContext}` : ''}`

  const messages = [{ role: 'user', content: userCommand }]

  let result = { success: false, message: 'İşlem tamamlanamadı.' }
  let iterations = 0
  const MAX_ITERATIONS = 5

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: CRM_TOOLS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text')
      if (textBlock) {
        result = { success: true, message: textBlock.text }
      }
      break
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        if (block.name === 'respond_to_user') {
          result = { success: block.input.success !== false, message: block.input.message }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ sent: true }),
          })
          continue
        }

        let toolResult
        try {
          toolResult = await executeHubSpotTool(block.name, block.input, installation.access_token)
        } catch (err) {
          toolResult = { error: err.message }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(toolResult),
        })
      }

      messages.push({ role: 'user', content: toolResults })
    }
  }

  return result
}

module.exports = { executeCrmCommand }
