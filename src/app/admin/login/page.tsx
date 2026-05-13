import { Suspense } from 'react'
import { LoginForm } from './_components/LoginForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Admin sign in',
  robots: { index: false, follow: false },
}

/**
 * The login route is exempt from the middleware gate so we can
 * render the form to a logged-out user. Auth happens via
 * POST /api/admin/session.
 *
 * The Suspense boundary is required because LoginForm reads
 * search params (?next=) at the client; without it Next 15's
 * router complains during the static prerender check.
 */
export default function AdminLoginPage() {
  // min-h-[60vh] keeps the form vertically centered without exceeding
  // the viewport once the parent layout's header is accounted for.
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-6 py-8">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
