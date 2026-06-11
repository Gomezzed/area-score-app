import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// POST /api/inquiries
//   LP のお問い合わせフォームから送信される。認証不要（公開）。
//   body: {
//     company_name, contact_name, email,   // 必須
//     phone?, plan_interest?, message?,     // 任意
//     consent,                              // 同意（必須・truthy）
//     website,                              // honeypot（空であること）
//   }
//
//   処理:
//     1. honeypot（website）が埋まっていればスパムとして握りつぶし、200 を返す（DB保存なし）
//     2. 必須項目・メール形式をバリデーション
//     3. Supabase（service_role）へ insert
//     4. Resend で通知メール送信（ベストエフォート）
//        ── RESEND_API_KEY 未設定・送信失敗でも、DB insert 成功なら成功レスポンスを返す

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 各フィールドの最大長（DoS・悪用対策）
const MAX = {
  company_name: 200,
  contact_name: 100,
  email: 254,
  phone: 50,
  plan_interest: 50,
  message: 5000,
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export async function POST(request: NextRequest) {
  // ── リクエストボディ ──
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正です' }, { status: 400 })
  }

  // ── 1. honeypot ──
  // bot は不可視フィールドにも入力しがち。埋まっていれば成功を装って握りつぶす。
  if (str(body.website)) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // ── 2. バリデーション ──
  const company_name = str(body.company_name)
  const contact_name = str(body.contact_name)
  const email = str(body.email)
  const phone = str(body.phone)
  const plan_interest = str(body.plan_interest)
  const message = str(body.message)
  const consent = body.consent === true || body.consent === 'on' || body.consent === 'true'

  const errors: string[] = []
  if (!company_name) errors.push('会社名は必須です')
  if (!contact_name) errors.push('担当者名は必須です')
  if (!email) errors.push('メールアドレスは必須です')
  else if (!EMAIL_RE.test(email)) errors.push('メールアドレスの形式が正しくありません')
  if (!consent) errors.push('プライバシーポリシーへの同意が必要です')

  if (
    company_name.length > MAX.company_name ||
    contact_name.length > MAX.contact_name ||
    email.length > MAX.email ||
    phone.length > MAX.phone ||
    plan_interest.length > MAX.plan_interest ||
    message.length > MAX.message
  ) {
    errors.push('入力内容が長すぎます')
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(' / ') }, { status: 400 })
  }

  // ── 3. Supabase へ insert（service_role / RLS バイパス） ──
  const admin = getSupabaseAdmin()
  if (!admin) {
    console.error('[inquiries] SUPABASE_SERVICE_ROLE_KEY 未設定のため保存できません')
    return NextResponse.json(
      { error: 'お問い合わせの受付処理が一時的に利用できません。時間をおいて再度お試しください。' },
      { status: 503 },
    )
  }

  const { error: dbError } = await admin.from('inquiries').insert({
    company_name,
    contact_name,
    email,
    phone: phone || null,
    plan_interest: plan_interest || null,
    message: message || null,
  })

  if (dbError) {
    console.error('[inquiries] insert に失敗:', dbError.message)
    return NextResponse.json(
      { error: '送信に失敗しました。時間をおいて再度お試しください。' },
      { status: 500 },
    )
  }

  // ── 4. Resend 通知（ベストエフォート） ──
  // DB 保存は成功済み。ここで失敗しても成功レスポンスを返す。
  await sendNotificationEmail({ company_name, contact_name, email, phone, plan_interest, message })

  return NextResponse.json({ ok: true }, { status: 201 })
}

interface NotifyPayload {
  company_name: string
  contact_name: string
  email: string
  phone: string
  plan_interest: string
  message: string
}

async function sendNotificationEmail(p: NotifyPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.INQUIRY_NOTIFY_EMAIL
  if (!apiKey || !to) {
    // 通知は任意。キー未設定なら静かにスキップ（DB保存は完了している）。
    return
  }
  // from は Resend で検証済みドメインのアドレスを指定する必要がある。
  // 未設定時は Resend のテスト用送信元にフォールバック（本番では INQUIRY_FROM_EMAIL を設定）。
  const from = process.env.INQUIRY_FROM_EMAIL || 'エリアスコア <onboarding@resend.dev>'

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const html = `
    <h2>新しいお問い合わせ</h2>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td><b>会社名</b></td><td>${esc(p.company_name)}</td></tr>
      <tr><td><b>担当者名</b></td><td>${esc(p.contact_name)}</td></tr>
      <tr><td><b>メール</b></td><td>${esc(p.email)}</td></tr>
      <tr><td><b>電話</b></td><td>${esc(p.phone) || '-'}</td></tr>
      <tr><td><b>興味のあるプラン</b></td><td>${esc(p.plan_interest) || '-'}</td></tr>
      <tr><td valign="top"><b>メッセージ</b></td><td>${esc(p.message).replace(/\n/g, '<br>') || '-'}</td></tr>
    </table>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: p.email,
        subject: `【エリアスコア】お問い合わせ: ${p.company_name}`,
        html,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[inquiries] Resend 送信失敗（通知のみ・保存は完了）:', res.status, detail)
    }
  } catch (err) {
    console.error('[inquiries] Resend 送信で例外（通知のみ・保存は完了）:', err)
  }
}
