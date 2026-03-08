import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const MODEL = "imagen-4.0-generate-001";

const STYLE_PREFIX =
  "tech flat design illustration, flat vector art, minimal, professional, dark background, " +
  "gold and teal accent colors, clean geometric shapes, modern business aesthetic, high quality, ";

const PRESETS: Record<string, string> = {
  hero: "a futuristic city skyline with glowing data streams and network nodes, wide cinematic",
  services: "four interconnected gears with digital icons representing business services",
  about: "a professional team of diverse people collaborating around a holographic display",
  feature_security: "a glowing shield with a lock icon, cybersecurity concept",
  feature_analytics: "an elegant dashboard with charts and data visualization",
  feature_cloud: "cloud infrastructure with connected servers and data flows",
  feature_support: "a headset with chat bubbles, customer support concept",
};

// POST /api/images/generate
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  try {
    const { prompt, preset, aspectRatio = "16:9", n = 1 } = await req.json();

    // Build final prompt
    const basePrompt = preset && PRESETS[preset] ? PRESETS[preset] : prompt;
    if (!basePrompt) {
      return NextResponse.json({ error: "prompt or preset is required" }, { status: 400 });
    }
    const finalPrompt = STYLE_PREFIX + basePrompt;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: finalPrompt }],
          parameters: {
            sampleCount: Math.min(n, 4),
            aspectRatio,
            safetyFilterLevel: "block_few",
            personGeneration: "allow_adult",
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err?.error?.message || "Imagen API error" }, { status: res.status });
    }

    const data = await res.json();
    const images = (data.predictions || []).map((p: { bytesBase64Encoded: string; mimeType: string }) => ({
      base64: p.bytesBase64Encoded,
      mimeType: p.mimeType || "image/png",
      dataUrl: `data:${p.mimeType || "image/png"};base64,${p.bytesBase64Encoded}`,
    }));

    return NextResponse.json({ images, prompt: finalPrompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET /api/images/generate?preset=hero — quick generate via GET
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  const { searchParams } = req.nextUrl;
  const preset = searchParams.get("preset") || "hero";
  const basePrompt = PRESETS[preset] || PRESETS.hero;
  const finalPrompt = STYLE_PREFIX + basePrompt;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predict?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: finalPrompt }],
        parameters: { sampleCount: 1, aspectRatio: "16:9", safetyFilterLevel: "block_few" },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: err?.error?.message }, { status: res.status });
  }

  const data = await res.json();
  const img = data.predictions?.[0];
  if (!img) return NextResponse.json({ error: "No image returned" }, { status: 500 });

  // Return as actual image binary
  const buffer = Buffer.from(img.bytesBase64Encoded, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": img.mimeType || "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
