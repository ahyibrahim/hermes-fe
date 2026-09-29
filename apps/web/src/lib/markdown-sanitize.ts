import DOMPurify, { type Config } from 'dompurify';

/**
 * Markdown attachments are rendered inline for every room member without a
 * click, so the output has to be inert *and* unable to impersonate the app:
 * no styles (a `<style>` or `style=` can cover the whole page), no forms or
 * inputs (a fake "session expired" login), no popovers, and no remote images
 * (each view would tell the author who read it and from where).
 */
const FORBID_TAGS = [
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'dialog',
  'details',
  'summary',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'svg',
  'math',
];

const FORBID_ATTR = ['style', 'class', 'id', 'name', 'popover', 'popovertarget', 'popovertargetaction', 'srcset'];

const CONFIG: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpeg|gif|webp);)/i,
};

const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);/i;

let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) {
    return purifier;
  }
  // A private instance so these hooks never touch any other DOMPurify use.
  const instance = DOMPurify(window);
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!/^(?:https?:|mailto:)/i.test(href)) {
        node.removeAttribute('href');
      } else {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!INLINE_IMAGE.test(src)) {
        const alt = node.getAttribute('alt');
        node.replaceWith(node.ownerDocument.createTextNode(alt ? `[image: ${alt}]` : '[image]'));
      }
    }
  });
  purifier = instance;
  return instance;
}

export function sanitizeMarkdownHtml(html: string): string {
  return getPurifier().sanitize(html, CONFIG) as string;
}
