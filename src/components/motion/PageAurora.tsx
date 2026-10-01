// src/components/motion/PageAurora.tsx
//
// The platform's header light: the same silk field as the landing hero, as a
// band across the top of the page that fades into plain canvas before the
// working surface starts. Identity where the eye enters, a quiet canvas where
// the numbers are read.

import ShaderField from './ShaderField';

export default function PageAurora({ height = 560 }: { height?: number }) {
  return (
    <div className="fx-aurora pointer-events-none absolute inset-x-0 top-0 -z-10" style={{ height }} aria-hidden>
      <ShaderField className="absolute inset-0" intensity={0.72} resolution={0.45} speed={0.8} />
      <div className="fx-aurora-veil absolute inset-0" />
    </div>
  );
}
