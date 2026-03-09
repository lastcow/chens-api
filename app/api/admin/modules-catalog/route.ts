import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey, requireAdmin } from "@/lib/auth";
import { stripe } from "@/lib/stripe";

// GET /api/admin/modules-catalog — list all modules with pricing
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const modules = await prisma.module.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ modules });
}

// PATCH /api/admin/modules-catalog — update pricing/options for a module
export async function PATCH(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;
  const adminErr = requireAdmin(req);
  if (adminErr) return adminErr;

  const body = await req.json();
  const { id, is_free, price_one_time, price_monthly, price_annual, allow_one_time, allow_monthly, allow_annual } = body;

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const mod = await prisma.module.findUnique({ where: { id } });
  if (!mod) return NextResponse.json({ error: "Module not found" }, { status: 404 });

  // If prices changed and Stripe product exists, create new prices
  let price_one_time_id = mod.stripe_price_one_time_id;
  let price_monthly_id  = mod.stripe_price_monthly_id;
  let price_annual_id   = mod.stripe_price_annual_id;
  let product_id        = mod.stripe_product_id;

  if (!is_free && mod.stripe_product_id) {
    const pid = mod.stripe_product_id;

    if (price_one_time !== undefined && Number(price_one_time) * 100 !== Number(mod.price_one_time) * 100) {
      if (price_one_time_id) await stripe.prices.update(price_one_time_id, { active: false }).catch(() => {});
      const p = await stripe.prices.create({ product: pid, unit_amount: Math.round(Number(price_one_time) * 100), currency: "usd" });
      price_one_time_id = p.id;
    }
    if (price_monthly !== undefined && Number(price_monthly) * 100 !== Number(mod.price_monthly) * 100) {
      if (price_monthly_id) await stripe.prices.update(price_monthly_id, { active: false }).catch(() => {});
      const p = await stripe.prices.create({ product: pid, unit_amount: Math.round(Number(price_monthly) * 100), currency: "usd", recurring: { interval: "month" } });
      price_monthly_id = p.id;
    }
    if (price_annual !== undefined && Number(price_annual) * 100 !== Number(mod.price_annual) * 100) {
      if (price_annual_id) await stripe.prices.update(price_annual_id, { active: false }).catch(() => {});
      const p = await stripe.prices.create({ product: pid, unit_amount: Math.round(Number(price_annual) * 100), currency: "usd", recurring: { interval: "year" } });
      price_annual_id = p.id;
    }
  } else if (!is_free && !mod.stripe_product_id) {
    // Create product for first time
    const prod = await stripe.products.create({ name: mod.label, description: mod.description, metadata: { module_id: id } });
    product_id = prod.id;
    if (price_one_time) {
      const p = await stripe.prices.create({ product: prod.id, unit_amount: Math.round(Number(price_one_time) * 100), currency: "usd" });
      price_one_time_id = p.id;
    }
    if (price_monthly) {
      const p = await stripe.prices.create({ product: prod.id, unit_amount: Math.round(Number(price_monthly) * 100), currency: "usd", recurring: { interval: "month" } });
      price_monthly_id = p.id;
    }
    if (price_annual) {
      const p = await stripe.prices.create({ product: prod.id, unit_amount: Math.round(Number(price_annual) * 100), currency: "usd", recurring: { interval: "year" } });
      price_annual_id = p.id;
    }
  }

  const updated = await prisma.module.update({
    where: { id },
    data: {
      ...(is_free !== undefined && { is_free }),
      ...(price_one_time !== undefined && { price_one_time }),
      ...(price_monthly !== undefined && { price_monthly }),
      ...(price_annual !== undefined && { price_annual }),
      ...(allow_one_time !== undefined && { allow_one_time }),
      ...(allow_monthly !== undefined && { allow_monthly }),
      ...(allow_annual !== undefined && { allow_annual }),
      stripe_product_id: product_id,
      stripe_price_one_time_id: price_one_time_id,
      stripe_price_monthly_id: price_monthly_id,
      stripe_price_annual_id: price_annual_id,
    },
  });

  return NextResponse.json({ module: updated });
}
