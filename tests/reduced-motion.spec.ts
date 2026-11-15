import { expect, test } from '@playwright/test';

test('operating-system reduced motion disables decorative transitions and smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const computed = await page.evaluate(() => {
    const element = document.createElement('div');
    element.style.transition = 'opacity 2s ease';
    element.style.animation = 'test-animation 2s infinite';
    element.style.scrollBehavior = 'smooth';
    document.body.appendChild(element);
    const style = getComputedStyle(element);
    const values = {
      transition: style.transitionDuration,
      animation: style.animationDuration,
      iterations: style.animationIterationCount,
      scrolling: style.scrollBehavior,
    };
    element.remove();
    return values;
  });
  expect(computed.transition).toBe('1e-05s');
  expect(computed.animation).toBe('1e-05s');
  expect(computed.iterations).toBe('1');
  expect(computed.scrolling).toBe('auto');
});
