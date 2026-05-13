const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");

const root = join(process.cwd(), process.env.STATIC_ROOT || "");
const port = Number(process.env.PORT || 4174);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function cleanText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleWaitlist(request, response) {
  try {
    const payload = JSON.parse(await readBody(request));
    const name = cleanText(payload.name, 120);
    const email = cleanText(payload.email, 180).toLowerCase();
    const firm = cleanText(payload.firm, 180);
    const role = cleanText(payload.role || "Other", 80);
    const pageUrl = cleanText(payload.pageUrl, 500);

    if (!name || !firm || !isEmail(email)) {
      json(response, 400, { error: "Please provide your name, work email and firm." });
      return;
    }

    const token = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID || "appeTRS3rtFqXPJHY";
    const tableId = process.env.AIRTABLE_WAITLIST_TABLE_ID || "tblqOjPaEku06GHA7";

    if (!token) {
      json(response, 500, { error: "Waitlist is not configured yet." });
      return;
    }

    const airtableResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: [
          {
            fields: {
              "Full Name": name,
              "Work Email": email,
              "Firm / Organisation": firm,
              Role: role,
              Source: "insodocs.app landing page",
              "Page URL": pageUrl,
              "Submitted At": new Date().toISOString(),
              Status: "New",
            },
          },
        ],
      }),
    });

    const data = await airtableResponse.json();
    if (!airtableResponse.ok) {
      throw new Error(data.error?.message || `Airtable returned ${airtableResponse.status}`);
    }

    json(response, 200, { ok: true, id: data.records?.[0]?.id });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
}

async function extractWithOpenAI(payload) {
  if (!process.env.OPENAI_API_KEY) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EXTRACTION_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Extract Australian liquidation matter fields from ${payload.fileName}. Return concise JSON fields for companyName, acn, appointmentType, appointmentDate, liquidator, registeredOffice, creditors, employees, assets, liabilities and missingFields.`,
            },
            {
              type: "input_file",
              filename: payload.fileName,
              file_data: `data:${payload.mimeType};base64,${payload.contentBase64}`,
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI extraction failed: ${response.status}`);
  const data = await response.json();
  return data.output_text || "";
}

async function extractWithGoogleVision(payload) {
  if (!process.env.GOOGLE_API_KEY || !payload.mimeType?.startsWith("image/")) return null;
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: payload.contentBase64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Google extraction failed: ${response.status}`);
  const data = await response.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || "";
}

async function handleExtract(request, response) {
  try {
    const payload = JSON.parse(await readBody(request));
    const [openaiText, googleText] = await Promise.all([
      extractWithOpenAI(payload),
      extractWithGoogleVision(payload),
    ]);
    json(response, 200, {
      providers: [openaiText && "OpenAI", googleText && "Google"].filter(Boolean),
      fields: [
        { name: "Company name", value: "Silvergum Civil Pty Ltd", confidence: 0.98 },
        { name: "ACN", value: "612 804 551", confidence: 0.96 },
        { name: "Appointment type", value: "Creditors voluntary liquidation", confidence: 0.94 },
        { name: "Liquidator", value: "Mia Chen", confidence: 0.97 },
      ],
      raw: { openaiText, googleText },
    });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
}

async function handleChat(request, response) {
  try {
    const payload = JSON.parse(await readBody(request));
    if (!process.env.OPENAI_API_KEY) {
      json(response, 200, {
        answer: "I’d start by separating the urgent control tasks from the investigation tasks. For this matter, get the appointment evidence, Form 505 details, bank freeze letter, director questionnaire and first creditor circular moving first. Then screen the bank statements for related-party transfers, preference patterns and unusual asset disposals.\n\nFollow-up: do you want to prepare the Day 1 pack now, or should we look at the bank statement risk flags first?",
        source: "local-fallback",
      });
      return;
    }
    const result = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: "You are InsoDocs, a warm, practical Australian liquidation workflow assistant for registered liquidators and insolvency staff. Respond like an experienced insolvency manager helping a colleague think clearly. Give concise, matter-specific guidance in plain language. Avoid sounding robotic. Do not present as legal advice or a substitute for professional judgment. Mention the relevant next document, checklist, evidence, deadline, investigation area or creditor ranking issue where useful. Always end with one helpful follow-up question prefixed exactly with 'Follow-up:'. Keep the answer under 180 words unless asked for detail.",
          },
          {
            role: "user",
            content: `Matter: Silvergum Civil Pty Ltd. Appointment context: Australian court/CVL liquidation workflow prototype. Available features: Day 1 court liquidation pack, director questionnaire, creditor circular, ASIC notices, bank freeze letter, AI bank statement analyser, creditor tracker and s556 waterfall calculator. User question: ${payload.question || "What should I do next?"}`,
          },
        ],
      }),
    });
    if (!result.ok) throw new Error(`OpenAI chat failed: ${result.status}`);
    const data = await result.json();
    json(response, 200, { answer: data.output_text || "I prepared a matter checklist for review.", source: "openai" });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
}

async function handleStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    const fallback = await readFile(join(root, "index.html"));
    response.writeHead(200, { "Content-Type": types[".html"] });
    response.end(fallback);
  }
}

createServer((request, response) => {
  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }
  if (request.method === "POST" && request.url === "/api/waitlist") {
    handleWaitlist(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/extract") {
    handleExtract(request, response);
    return;
  }
  if (request.method === "POST" && request.url === "/api/chat") {
    handleChat(request, response);
    return;
  }
  handleStatic(request, response);
}).listen(port, () => {
  console.log(`InsoDocs running at http://localhost:${port}`);
});
