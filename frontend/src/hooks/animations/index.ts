/**
 * Reusable anime.js v4 animation hooks.
 *
 * All hooks:
 * - Use anime.js v4 API (animate, stagger, createScope, spring, utils)
 * - Respect prefers-reduced-motion
 * - Clean up via scope.revert() on unmount
 * - Follow Vantai design: subtle, "barely visible" motion
 *
 * @module hooks/animations
 */

export { usePageAnimations } from './usePageAnimations';
export type { UsePageAnimationsOptions } from './usePageAnimations';

export { useListAnimations } from './useListAnimations';
export type { UseListAnimationsOptions } from './useListAnimations';

export { useCounterAnimation } from './useCounterAnimation';
export type { CounterTarget, CounterOptions } from './useCounterAnimation';

export { useMotionPath } from './useMotionPath';
export type { UseMotionPathOptions, UseMotionPathReturn } from './useMotionPath';
