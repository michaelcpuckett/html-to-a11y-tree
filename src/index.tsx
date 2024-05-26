import process from "process";
import fs from "fs";
import path from "path";
import ReactDOMServer from "react-dom/server";
import parseFromString from "html-dom-parser";
import type {
  DOMNode as ParserNode,
  Comment as ParserComment,
  Element as ParserElement,
  Text as ParserText,
} from "html-dom-parser";
import { ariaToHtmlMapping } from "./ariaToHtmlMapping";
import { ariaRolesWithPhrasingDescendants } from "./ariaRolesWithPhrasingDescendants";
import { ariaRolesWithPresentationalChildren } from "./ariaRolesWithPresentationalChildren";
import { ariaRolesWithoutAriaLabelSupport } from "./ariaRolesWithoutAriaLabelSupport";
import { containerRoles, groupingRoles, landmarkRoles } from "./landmarkRoles";

const specialAttributes = [
  "type",
  "type=text",
  "type=search",
  "type=radio",
  "type=checkbox",
  "type=button",
  "type=submit",
  "type=reset",
  "href",
  "scope",
  "multiple",
];

const relevantAttributes = [
  "id",
  "hidden",
  "tabindex",
  "title",
  "alt",
  "href",
  "disabled",
  "inert",
  "src",
  "colspan",
  "rowspan",
  "scope",
  "aria-expanded",
  "aria-haspopup",
  "aria-hidden",
  "aria-describedby",
  "aria-owns",
  "aria-controls",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "aria-invalid",
  "aria-required",
  "aria-pressed",
  "aria-orientation",
  "aria-sort",
  "aria-autocomplete",
  "aria-multiline",
  "aria-readonly",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "aria-valuemin",
  "aria-valuemax",
  "aria-valuenow",
];

interface LabelledByReference {
  type: "aria-labelledby";
  value: string;
}

function guardIsRole(value: unknown): value is keyof typeof ariaToHtmlMapping {
  return (
    typeof value === "string" && Object.keys(ariaToHtmlMapping).includes(value)
  );
}

const filterOutCommentsAndDirectives = (node: ParserNode) => {
  return node.type !== "directive" && node.type !== "comment";
};

function guardIsParserElement(value: unknown): value is ParserElement {
  return guardIsParserNode(value) && value.type === "tag";
}

function guardIsParserText(value: unknown): value is ParserText {
  return guardIsParserNode(value) && value.type === "text";
}

function guardIsParserNode(value: unknown): value is ParserNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    ["tag", "text"].includes(value.type)
  );
}

interface IAccElement {
  attributes: Record<string, string>;
  children: IAccNode[];
  tagName: string;
  role: string;
  accName: string | LabelledByReference;
  type: "AccElement";
}

interface IAccText {
  data: string;
  type: "AccText";
}

type IAccNode = IAccElement | IAccText;

function getChildNodes(children: unknown[]): IAccNode[] {
  const childParserNodes = children.filter(guardIsParserNode);
  return childParserNodes.map(convertParsedNode);
}

class AccElement implements IAccElement {
  attributes: Record<string, string>;
  children: IAccNode[];
  tagName: string;
  accName: string | LabelledByReference;
  role: string;
  type: "AccElement";

  constructor(
    tagName: string,
    attributes: Record<string, string>,
    children: IAccNode[]
  ) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = children;
    this.type = "AccElement";
    this.role = this.getRoleFromTagName();
    this.accName = this.getAccessibleName();
  }

  getRoleFromString(tagName: string): string | undefined {
    const [role] =
      Object.entries(ariaToHtmlMapping).find(([, value]) =>
        value.includes(tagName)
      ) ?? [];

    return role;
  }

  getRoleFromTagName(): keyof typeof ariaToHtmlMapping {
    const roleAttribute = this.attributes.role;

    if (guardIsRole(roleAttribute)) {
      return roleAttribute;
    }

    const role = this.getRoleFromString(this.tagName);

    if (guardIsRole(role)) {
      return role;
    }

    for (const specialAttribute of specialAttributes) {
      if (this.attributes[specialAttribute] === undefined) {
        const typedTagNameWithoutAttribute = `${this.tagName}:not([${specialAttribute}])`;

        const roleByType = this.getRoleFromString(typedTagNameWithoutAttribute);

        if (guardIsRole(roleByType)) {
          return roleByType;
        }

        continue;
      }

      const typedTagName = `${this.tagName}[${specialAttribute}]`;
      const roleByType = this.getRoleFromString(typedTagName);

      if (guardIsRole(roleByType)) {
        return roleByType;
      }
    }

    return "generic";
  }

  getAccessibleName(): string | LabelledByReference {
    if (!ariaRolesWithoutAriaLabelSupport.includes(this.role)) {
      const label = this.attributes["aria-label"];

      if (label) {
        return label;
      }

      const labelledBy = this.attributes["aria-labelledby"];

      if (labelledBy) {
        return {
          type: "aria-labelledby",
          value: labelledBy,
        };
      }

      // TODO. Implement aria-labelledby support by looking up the text of the
      // element with the ID
    }

    if (ariaRolesWithPresentationalChildren.includes(this.role)) {
      const innerText = this.children
        .map(this.getChildTextNodes)
        .flat()
        .map((child) => child.data)
        .join(" ");

      return innerText;
    }

    return "";
  }

  getChildTextNodes = (node: IAccNode): IAccText[] => {
    if (guardIsAccText(node)) {
      return [node];
    }

    if (guardIsAccElement(node)) {
      return node.children.map(this.getChildTextNodes).flat();
    }

    throw new Error("Unknown node type");
  };
}

class AccText implements IAccText {
  data: string;
  type: "AccText";

  constructor(data: string) {
    this.data = data;
    this.type = "AccText";
  }
}

const convertParsedNode = (node: ParserNode): IAccNode => {
  if (guardIsParserElement(node)) {
    const { attribs, children, name } = node;

    return new AccElement(name, attribs, getChildNodes(children));
  }

  if (guardIsParserText(node)) {
    const { data } = node;

    return new AccText(data);
  }

  throw new Error("Unknown node type");
};

function guardIsAccElement(value: unknown): value is IAccElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "AccElement"
  );
}

function guardIsAccText(value: unknown): value is IAccText {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "AccText"
  );
}

function guardIsAccNode(value: unknown): value is IAccNode {
  return guardIsAccElement(value) || guardIsAccText(value);
}

function assertIsAccNode(value: unknown): IAccNode {
  if (!guardIsAccNode(value)) {
    throw new Error("Expected value to be an IAccNode");
  }

  return value;
}

function filterOutEmptyRoleNodesFromTree(node: IAccNode[]): IAccNode[] {
  const arrayOfArrays = node.map((node) => {
    if (guardIsAccElement(node)) {
      if (typeof node.attributes.hidden !== "undefined") {
        return [];
      }

      const children = filterOutEmptyRoleNodesFromTree(node.children);

      if (
        node.role !== "none" &&
        node.role !== "presentation" &&
        node.role !== "generic"
      ) {
        return [
          new AccElement(
            node.tagName,
            node.attributes,
            filterOutEmptyRoleNodesFromTree(children)
          ),
        ];
      } else if (children.length) {
        return filterOutEmptyRoleNodesFromTree(children);
      }

      return [];
    }

    if (guardIsAccText(node)) {
      const stripped = node.data.trim();

      if (!stripped.length) {
        return [null];
      }

      return [new AccText(node.data.trim().replace(/\s+/g, " "))];
    }

    return [node];
  });

  return arrayOfArrays
    .flat(1)
    .filter((node) => node !== null)
    .map(assertIsAccNode);
}

function flattenNodes(nodes: IAccNode[]): IAccNode[] {
  return nodes.reduce((accumulator, node) => {
    if (guardIsAccElement(node)) {
      accumulator.push(node, ...flattenNodes(node.children));
    } else {
      accumulator.push(node);
    }

    return accumulator;
  }, [] as IAccNode[]);
}

function renderToMarkdown(nodes: IAccNode[]) {
  function getLabelledByReferenceText(labelledBy: LabelledByReference): string {
    const element = flattenNodes(nodes).find((node) => {
      if (guardIsAccElement(node)) {
        return node.attributes.id === labelledBy.value;
      }
    });

    if (guardIsAccElement(element)) {
      return element.children
        .map((child) => {
          if (guardIsAccText(child)) {
            return child.data;
          }

          return "";
        })
        .join(" ");
    }

    return "";
  }

  function renderNodeToMarkdown(
    node: IAccNode,
    level = 0,
    parentPrefix = ""
  ): string {
    const indent = (level: number) => "  ".repeat(level);

    if (guardIsAccElement(node)) {
      const listItemLevel = node.role === "list" ? level + 1 : level;

      const isContainer = containerRoles.includes(node.role);
      const isLink = node.role === "link";

      const accName = node.accName
        ? typeof node.accName === "string"
          ? node.accName
          : getLabelledByReferenceText(node.accName)
        : node.attributes.title || node.attributes.alt || "";

      const headingLevel = Number(
        node.role === "heading"
          ? node.attributes["aria-level"] || node.tagName[1]
          : 0
      );

      const listitemPrefix = "-";
      const headingPrefix = "#".repeat(headingLevel);

      const prefixes: Record<string, string> = {
        listitem: listitemPrefix,
        heading: headingPrefix,
      };

      const prefix = `${prefixes[node.role] ?? ""}`;

      return (
        (isContainer
          ? `${indent(level)}[${node.role}]${
              accName ? ` "${accName}"` : ""
            }\n\n`
          : "") +
        (isLink ? `${indent(level)}(link: ${node.attributes.href})\n` : "") +
        node.children
          .map((child) =>
            renderNodeToMarkdown(
              child,
              listItemLevel,
              `${prefix ? `${prefix} ` : ""}`
            )
          )
          .join("\n\n")
      );
    }

    if (guardIsAccText(node)) {
      return `${indent(level)}${parentPrefix}${node.data}`;
    }

    throw new Error("Unknown node type");
  }

  return nodes
    .map((node) => renderNodeToMarkdown(node))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function renderToJsx(nodes: IAccNode[]) {
  function renderNodeToJsx(node: IAccNode, level = 0): string {
    if (guardIsAccElement(node)) {
      const headingLevel = Number(
        node.role === "heading"
          ? node.attributes["aria-level"] || node.tagName[1]
          : 0
      );

      const attributes = Object.entries(node.attributes)
        .filter(
          ([key]) => key.startsWith("aria-") || relevantAttributes.includes(key)
        )
        .map(([key, value]) => `${key}="${value.replace(/"/g, "'")}"`)
        .filter(Boolean)
        .join(" ");

      const children = node.children
        .filter((child) => {
          if (guardIsAccText(child)) {
            return child.data.trim().length > 0;
          }

          return true;
        })
        .map((child) => renderNodeToJsx(child, level + 1))
        .join("\n");

      const componentName = node.role[0].toUpperCase() + node.role.slice(1);
      const headingLevelAttr = headingLevel
        ? ` aria-level={${headingLevel}}`
        : "";
      const props = attributes ? ` ${attributes}` : "" + headingLevelAttr;

      return `<${componentName}${props}>${children}</${componentName}>`;
    }

    if (guardIsAccText(node)) {
      return `${node.data
        .trim()
        .replace(/[\u00A0-\u9999<>\&]/g, (i) => "&#" + i.charCodeAt(0) + ";")}`;
    }

    throw new Error("Unknown node type");
  }

  return nodes.map((node) => renderNodeToJsx(node)).join("\n");
}

function renderToSimplifiedHtml(nodes: IAccNode[]) {
  function renderNodeToSimplifiedHtml(node: IAccNode, level = 0): string {
    if (guardIsAccElement(node)) {
      const headingLevel = Number(
        node.role === "heading"
          ? node.attributes["aria-level"] || node.tagName[1]
          : 0
      );

      const attributes = Object.entries(node.attributes)
        .filter(
          ([key]) => key.startsWith("aria-") || relevantAttributes.includes(key)
        )
        .map(
          ([key, value]) =>
            `${key}${value ? `="${value.replace(/"/g, "'")}"` : ""}`
        )
        .filter(Boolean);

      const children = node.children
        .filter((child) => {
          if (guardIsAccText(child)) {
            return child.data.trim().length > 0;
          }

          return true;
        })
        .map((child) => renderNodeToSimplifiedHtml(child, level + 1))
        .join("\n");

      const headingLevelAttr = headingLevel ? `h${headingLevel}` : "";

      let htmlElement = "";

      Object.entries(ariaToHtmlMapping).forEach(([ariaRole, mapping]) => {
        if (ariaRole === node.role) {
          htmlElement = mapping[0];
        }
      });

      const htmlElementAttributes = htmlElement.split("[");
      htmlElement = htmlElementAttributes[0];

      if (htmlElement === "h1" && headingLevelAttr) {
        htmlElement = headingLevelAttr;
      }

      const extraAttributesString =
        htmlElementAttributes[1]?.split("]")?.[0] ?? "";

      const extraAttributes = extraAttributesString
        .split(" ")
        .map((attribute) => attribute.trim())
        .filter(Boolean);

      const initialValue: Record<string, string> = {};

      const attributesObject = [...extraAttributes, ...attributes].reduce(
        (acc, item) => {
          const [key, value = ""] = item.split("=");
          acc[key] = value.replace(/"/g, "");
          return acc;
        },
        initialValue
      );

      const isSelfClosing = ["input", "img", "hr"].includes(htmlElement);

      return `<${htmlElement}${Object.entries(attributesObject)
        .map(([key, value]) => ` ${key}${value ? `="${value}"` : ""}`)
        .join(" ")}>${isSelfClosing ? "" : `${children}</${htmlElement}>`}`;
    }

    if (guardIsAccText(node)) {
      return `${node.data
        .trim()
        .replace(/[\u00A0-\u9999<>\&]/g, (i) => "&#" + i.charCodeAt(0) + ";")}`;
    }

    throw new Error("Unknown node type");
  }

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Simplified HTML</title>
        <style>
          * {
            box-sizing: border-box;
          }
          html {
            font-family: sans-serif;
            color-scheme: dark;
          }
          img {
            max-width: 100%;
          }
        </style>
      </head>
      ${nodes.map((node) => renderNodeToSimplifiedHtml(node)).join("\n")}
    </html>
  `;
}

async function getAccessibilityTree(url: string, debug = false) {
  const htmlFile = await fetch(url).then((response) => response.text());

  if (debug) {
    fs.writeFileSync(
      path.resolve("./results/", `${new URL(url).hostname}.html`),
      htmlFile
    );
  }

  const parsedDocument = parseFromString(htmlFile, {
    lowerCaseTags: true,
  });

  const accDocument = parsedDocument
    .filter(filterOutCommentsAndDirectives)
    .map(convertParsedNode);

  const filteredAccDocument = filterOutEmptyRoleNodesFromTree(accDocument)
    .filter(guardIsAccElement)
    .map((node) => {
      return new AccElement(node.tagName, node.attributes, node.children);
    });

  return filteredAccDocument;
}

function isValidFormat(
  format: string
): format is "json" | "jsx" | "md" | "html" {
  return ["json", "jsx", "md", "html"].includes(format);
}

async function cli() {
  const [url, format, debug] = process.argv.slice(2);

  if (!url) {
    throw new Error("Expected URL to be defined");
  }

  if (!isValidFormat(format)) {
    throw new Error("Invalid format");
  }

  const accessibilityTree = await getAccessibilityTree(
    url,
    debug === "--debug"
  );

  if (!accessibilityTree) {
    throw new Error("Expected result to be defined");
  }

  if (format === "json") {
    fs.writeFileSync(
      path.resolve("./results/", `${new URL(url).hostname}.acc.json`),
      JSON.stringify(accessibilityTree, null, 2)
    );

    console.log(JSON.stringify(accessibilityTree, null, 2));
  }

  if (format === "jsx") {
    const jsx = renderToJsx(accessibilityTree);

    fs.writeFileSync(
      path.resolve("./results/", `${new URL(url).hostname}.acc.jsx`),
      jsx
    );

    return jsx;
  }

  if (format === "html") {
    const html = renderToSimplifiedHtml(accessibilityTree);

    fs.writeFileSync(
      path.resolve("./results/", `${new URL(url).hostname}.acc.html`),
      html
    );

    return html;
  }

  if (format === "md") {
    const markdown = renderToMarkdown(accessibilityTree);

    fs.writeFileSync(
      path.resolve("./results/", `${new URL(url).hostname}.acc.md`),
      markdown
    );

    return markdown;
  }
}

cli();
