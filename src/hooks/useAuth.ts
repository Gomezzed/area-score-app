'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// 認証状態フック: 現在のユーザー / ログアウト / ロード中フラグを返す。
// Supabase の onAuthStateChange を購読し、サインイン・サインアウトに追従する。
export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) {
        setUser(data.user ?? null)
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    // フルリロードでセッションクッキーを確実に破棄してから /login へ
    window.location.href = '/login'
  }

  return { user, signOut, loading }
}
