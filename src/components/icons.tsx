/* eslint-disable react-refresh/only-export-components -- this module is the
   icon vocabulary: it deliberately exports both the icon constants and the
   InlineIcon component, and splitting them would only satisfy a dev-server
   hot-reload rule. */
// src/components/icons.tsx
//
// One icon vocabulary for the app.
//
// The UI used emoji as iconography (💱 for a trade, ⛽ for gas, 🖼️ for an NFT).
// Emoji render differently on every platform, cannot be sized or coloured to
// match surrounding text, and carry a playful tone that undercuts a product
// showing people their tax position. Phosphor gives one family, one weight and
// colour inherited from CSS.

import {
  ArrowsLeftRightIcon,
  ChartLineUpIcon,
  DiamondIcon,
  ImageSquareIcon,
  QuestionIcon,
  GasPumpIcon,
  WarningIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  StarIcon,
  UserIcon,
  ChartPieSliceIcon,
  BrainIcon,
  KeyIcon,
  CircleIcon,
  CurrencyEthIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import type { TaxCategory } from '../types';

export type { PhosphorIcon };

/** Transaction taxonomy. These four are the product's core vocabulary. */
export const CATEGORY_ICON: Record<TaxCategory, PhosphorIcon> = {
  trade: ArrowsLeftRightIcon,
  income: DiamondIcon,
  transfer: ArrowsLeftRightIcon,
  nft: ImageSquareIcon,
  unknown: QuestionIcon,
};

export {
  ArrowsLeftRightIcon,
  ChartLineUpIcon,
  DiamondIcon,
  ImageSquareIcon,
  QuestionIcon,
  GasPumpIcon,
  WarningIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  StarIcon,
  UserIcon,
  ChartPieSliceIcon,
  BrainIcon,
  KeyIcon,
  CircleIcon,
  CurrencyEthIcon,
};

/**
 * Inline icon sized to sit beside text without disturbing the line box.
 * Colour is inherited, so it follows whatever the surrounding text does.
 */
export function InlineIcon({
  icon: Icon,
  size = 15,
  weight = 'bold',
  className,
  style,
}: {
  icon: PhosphorIcon;
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Icon
      size={size}
      weight={weight}
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden
    />
  );
}
