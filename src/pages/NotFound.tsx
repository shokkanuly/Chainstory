import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-semibold">404</h1>
        <p className="text-muted-foreground">Страница не найдена</p>
        <Link
          to="/"
          className="inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          На главную
        </Link>
      </div>
    </main>
  )
}
