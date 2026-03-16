import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { requireMsbizPermission } from "@/lib/msbiz-auth";

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY!;

// GET /api/msbiz/addresses/lookup?q=... — Google Places autocomplete
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "addresses.view");
  if (result instanceof NextResponse) return result;

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 3) return NextResponse.json({ predictions: [] });

  if (!GOOGLE_MAPS_KEY) {
    return NextResponse.json({ predictions: [], error: "Google Maps API key not configured" });
  }

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=address&components=country:us&key=${GOOGLE_MAPS_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.error("[msbiz/addresses/lookup] Google API error:", data.status, data.error_message);
    return NextResponse.json({ predictions: [], google_status: data.status, google_error: data.error_message });
  }

  return NextResponse.json({ predictions: data.predictions ?? [] });
}

// GET /api/msbiz/addresses/lookup?place_id=... — get place details
export async function POST(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const result = await requireMsbizPermission(req, "addresses.view");
  if (result instanceof NextResponse) return result;

  const { place_id } = await req.json();
  if (!place_id) return NextResponse.json({ error: "place_id required" }, { status: 400 });

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=formatted_address,address_components,geometry&key=${GOOGLE_MAPS_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const result2 = data.result;
  if (!result2) return NextResponse.json({ error: "Place not found" }, { status: 404 });

  // Parse address components
  const components: Record<string, string> = {};
  for (const c of result2.address_components ?? []) {
    const type = c.types[0];
    components[type] = c.long_name;
    if (type === "administrative_area_level_1") components["state_short"] = c.short_name;
  }

  return NextResponse.json({
    place: {
      full_address: result2.formatted_address,
      street1: `${components.street_number ?? ""} ${components.route ?? ""}`.trim(),
      city: components.locality || components.sublocality || components.neighborhood,
      state: components.state_short,
      zip: components.postal_code,
      country: components.country === "United States" ? "US" : components.country,
      lat: result2.geometry?.location?.lat,
      lng: result2.geometry?.location?.lng,
      google_place_id: place_id,
    },
  });
}
