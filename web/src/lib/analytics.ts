const COUNTER_ID = 113120530

type Goal = 'lead_submit_success' | 'lead_form_open' | 'lead_form_start' | 'product_add' | 'contact_phone_click' | 'contact_email_click'
type GoalParams = { form_location?: 'inline' | 'modal'; items_count?: number }

declare global {
  interface Window {
    ym?: (counterId: number, method: 'reachGoal', goal: Goal, params?: GoalParams) => void
  }
}

// Keep the payload deliberately small: no form values, URLs, contact details,
// user-generated strings or prices (a request for a quote is not a sale).
export function trackGoal(goal: Goal, params: GoalParams = {}): void {
  if (typeof window === 'undefined') return
  try {
    if (typeof window.ym !== 'function') return
    const safeParams: GoalParams = {}
    if (params.form_location === 'inline' || params.form_location === 'modal') safeParams.form_location = params.form_location
    if (typeof params.items_count === 'number' && Number.isFinite(params.items_count)) safeParams.items_count = Math.max(0, Math.min(100, Math.floor(params.items_count)))
    window.ym(COUNTER_ID, 'reachGoal', goal, safeParams)
  } catch {
    // Analytics must never affect selecting products or sending a request.
  }
}

export function trackContactClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  const href = event.target.closest('a')?.getAttribute('href') || ''
  if (href.startsWith('tel:')) trackGoal('contact_phone_click')
  if (href.startsWith('mailto:')) trackGoal('contact_email_click')
}
