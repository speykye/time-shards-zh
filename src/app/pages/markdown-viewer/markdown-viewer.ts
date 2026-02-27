import { Component, Input, OnChanges, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

@Component({
  selector: 'app-markdown-viewer',
  imports: [],
  templateUrl: './markdown-viewer.html',
  styleUrl: './markdown-viewer.scss',
  standalone: true,
})
export class MarkdownViewer {
  @Input() markdown: string = '';
  safeHtml: SafeHtml = '';

  constructor(private sanitizer: DomSanitizer) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['markdown']) {
      this.renderMarkdown();
    }
  }

  private renderMarkdown(): void {
    if (!this.markdown) {
      this.safeHtml = '';
      return;
    }

    // 1. 解析 Markdown 为 HTML
    const rawHtml = marked.parse(this.markdown, {
      breaks: true, // 支持 GitHub 风格的换行
      gfm: true     // 支持 GitHub Flavored Markdown
    }) as string;

    // 2. 清洗 HTML (防 XSS)
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true }, // 只允许 HTML 标签，禁止 SVG/MathML 等复杂结构以防万一
      ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'a', 'hr', 'strong', 'em', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br'],
      ALLOWED_ATTR: ['href', 'target', 'rel']
    });

    // 3. 信任并绑定
    this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(cleanHtml);
  }
}
