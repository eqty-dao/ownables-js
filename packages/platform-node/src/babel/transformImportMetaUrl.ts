import type { PluginObj } from '@babel/core';
import type { MemberExpression, StringLiteral } from '@babel/types';

type MemberExpressionPath = {
  node: MemberExpression;
  replaceWith(node: StringLiteral): void;
};

export default function transformImportMetaUrl(): PluginObj {
  return {
    name: 'transform-import-meta-url',
    visitor: {
      MemberExpression(path: MemberExpressionPath) {
        const node = path.node as MemberExpression;

        if (
          node.object.type === 'MetaProperty' &&
          node.object.meta.name === 'import' &&
          node.object.property.name === 'meta' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'url'
        ) {
          const replacement: StringLiteral = {
            type: 'StringLiteral',
            value: 'file:///ownable.js',
          };
          path.replaceWith(replacement);
        }
      },
    },
  };
}
