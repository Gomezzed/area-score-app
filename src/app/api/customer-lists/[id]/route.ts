import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { guardFeature } from '@/lib/subscription'
import { isCustomerListEnabled } from '@/lib/customer-list/server'

export const runtime = 'nodejs'

// DELETE /api/customer-lists/[id]
//   名簿を削除する（customer_list_rows は ON DELETE CASCADE で連動削除）。
//   RLS: cl_delete_own により自分の名簿のみ削除可（他人の id を渡しても 0 行）。
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCustomerListEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const denied = await guardFeature('townAcquisitionPriority')
  if (denied) return denied

  const { id: listId } = await params
  const supabase = await createSupabaseServerClient()

  // 削除（RLS で自分の行のみ対象）。削除件数を確認し、無ければ 404。
  const { data, error } = await supabase
    .from('customer_lists')
    .delete()
    .eq('id', listId)
    .select('id')

  if (error) {
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, id: listId })
}
