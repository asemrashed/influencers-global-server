import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize user-supplied HTML BEFORE it is written to the database.
 * Plain-text fields must NOT go through this; they are escaped on output by consumers.
 * Allow-list is deliberately small: rich text only, no scripts, styles, forms or embeds.
 */
export function sanitizeRichText(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'a', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    ADD_ATTR: ['target'],
  });
}
