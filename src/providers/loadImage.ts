/**
 * Load a picture into an image element and resolve when it has loaded.
 * This uses the load event, not HTMLImageElement.decode(). decode() waits for the browser to have a frame to render,
 * so it can stall when the page is in a background or hidden tab. Drawing a loaded picture decodes it as needed.
 */
export function loadImage(url: string, image: HTMLImageElement = new Image()): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture could not be loaded.'));
    image.src = url;
  });
}
