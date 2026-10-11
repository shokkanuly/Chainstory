export default function ReceiptReference({ synthetic, href, children, className }: {
  synthetic: boolean; href: string; children: string; className?: string;
}) {
  if (synthetic) return <span className={className} title="Synthetic receipt identifier; no real transaction">{children} <span className="font-sans text-muted-foreground">· example</span></span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={`${className ?? ''} underline underline-offset-4`}>{children}</a>;
}
