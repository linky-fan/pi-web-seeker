import { gsap } from "gsap";

const reduceMotionQuery = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(reduceMotionQuery).matches;
}

export function revealElement(
  element: Element | null,
  options: { y?: number; scale?: number; delay?: number; duration?: number } = {}
) {
  if (!element) return undefined;
  if (prefersReducedMotion()) {
    gsap.set(element, { autoAlpha: 1, clearProps: "transform" });
    return undefined;
  }

  return gsap.fromTo(
    element,
    {
      autoAlpha: 0,
      y: options.y ?? -4,
      scale: options.scale ?? 1,
    },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      delay: options.delay ?? 0,
      duration: options.duration ?? 0.22,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "opacity,visibility,transform",
    }
  );
}

export function revealChildren(
  container: Element | null,
  selector: string,
  options: { y?: number; limit?: number; stagger?: number; duration?: number } = {}
) {
  if (!container) return undefined;
  const children = Array.from(container.querySelectorAll(selector)).slice(0, options.limit ?? 20);
  if (children.length === 0) return undefined;

  if (prefersReducedMotion()) {
    gsap.set(children, { autoAlpha: 1, clearProps: "transform" });
    return undefined;
  }

  return gsap.fromTo(
    children,
    { autoAlpha: 0, y: options.y ?? 4 },
    {
      autoAlpha: 1,
      y: 0,
      duration: options.duration ?? 0.2,
      stagger: options.stagger ?? 0.018,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "opacity,visibility,transform",
    }
  );
}

export function rotateOnce(element: Element | null) {
  if (!element || prefersReducedMotion()) return undefined;
  return gsap.fromTo(
    element,
    { rotation: 0 },
    {
      rotation: "360_cw",
      duration: 0.42,
      ease: "power2.out",
      overwrite: "auto",
      clearProps: "transform",
    }
  );
}

export function popOnce(element: Element | null) {
  if (!element || prefersReducedMotion()) return undefined;
  return gsap.fromTo(
    element,
    { scale: 0.92 },
    {
      scale: 1,
      duration: 0.28,
      ease: "back.out(1.8)",
      overwrite: "auto",
      clearProps: "transform",
    }
  );
}

export function animateModalIn(overlay: Element | null, panel: Element | null) {
  if (!overlay || !panel) return undefined;
  if (prefersReducedMotion()) {
    gsap.set([overlay, panel], { autoAlpha: 1, clearProps: "transform" });
    return undefined;
  }

  return gsap.timeline({ defaults: { ease: "power2.out", overwrite: "auto" } })
    .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16 })
    .fromTo(
      panel,
      { autoAlpha: 0, y: 12, scale: 0.985 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, clearProps: "opacity,visibility,transform" },
      "<0.03"
    );
}

export function animateModalOut(
  overlay: Element | null,
  panel: Element | null,
  onComplete: () => void
) {
  if (!overlay || !panel || prefersReducedMotion()) {
    onComplete();
    return undefined;
  }

  return gsap.timeline({
    defaults: { ease: "power2.in", overwrite: "auto" },
    onComplete,
  })
    .to(panel, { autoAlpha: 0, y: 8, scale: 0.985, duration: 0.14 })
    .to(overlay, { autoAlpha: 0, duration: 0.12 }, "<0.02");
}
