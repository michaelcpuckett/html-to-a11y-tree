import process from "process";
import fs from "fs";
import path from "path";
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
import { groupingRoles, landmarkRoles } from "./landmarkRoles";

const specialAttributes = ["type", "scope", "multiple"];

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

    if (this.attributes.type) {
      for (const specialAttribute of specialAttributes) {
        if (this.attributes[specialAttribute] === undefined) {
          continue;
        }

        const typedTagName = `${this.tagName}[${specialAttribute}=${this.attributes[specialAttribute]}]`;
        const roleByType = this.getRoleFromString(typedTagName);

        if (guardIsRole(roleByType)) {
          return roleByType;
        }
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

function joinAdjacentTextNodes(nodes: IAccNode[]): IAccNode[] {
  return nodes
    .reduce((accumulator, node, index, array) => {
      if (guardIsAccText(node)) {
        const previousNode = array[index - 1];

        if (guardIsAccText(previousNode)) {
          accumulator.splice(
            accumulator.indexOf(previousNode),
            1,
            new AccText(`${previousNode.data} ${node.data}`)
          );

          return accumulator;
        } else {
          accumulator.push(node);
          return accumulator;
        }
      }

      if (guardIsAccElement(node)) {
        accumulator.push(
          new AccElement(
            node.tagName,
            node.attributes,
            joinAdjacentTextNodes(node.children)
          )
        );
        return accumulator;
      }

      throw new Error("Unknown node type");
    }, [] as IAccNode[])
    .filter(guardIsAccNode);
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

      const isLandmarkOrGroup =
        landmarkRoles.includes(node.role) || groupingRoles.includes(node.role);
      const accName = node.accName
        ? typeof node.accName === "string"
          ? node.accName
          : getLabelledByReferenceText(node.accName)
        : node.attributes.title || node.attributes.alt || "";

      const headingLevel = Number(
        node.role === "heading"
          ? node.attributes["aria-level"] || node.tagName[1]
          : 1
      );

      const listitemPrefix = "-";
      const headingPrefix = "#".repeat(headingLevel);

      const prefixes: Record<string, string> = {
        listitem: listitemPrefix,
        heading: headingPrefix,
      };

      const prefix = `${prefixes[node.role] ?? ""}`;

      return (
        (isLandmarkOrGroup
          ? `${indent(level)}[${node.role}]${
              accName ? ` "${accName}"` : ""
            }\n\n`
          : "") +
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

async function run() {
  const [url] = process.argv.slice(2);

  const htmlFile = await fetch(url).then((response) => response.text());

  const parsedDocument = parseFromString(htmlFile, {
    lowerCaseTags: true,
  });

  const accDocument = parsedDocument
    .filter(filterOutCommentsAndDirectives)
    .map(convertParsedNode);

  const filteredAccDocument = filterOutEmptyRoleNodesFromTree(accDocument)
    .filter(guardIsAccElement)
    .map((node) => {
      return new AccElement(
        node.tagName,
        node.attributes,
        joinAdjacentTextNodes(node.children)
      );
    });

  fs.writeFileSync(
    path.resolve("./results/", `${new URL(url).hostname}.acc.json`),
    JSON.stringify(filteredAccDocument, null, 2)
  );

  const markdown = renderToMarkdown(filteredAccDocument);

  fs.writeFileSync(
    path.resolve("./results/", `${new URL(url).hostname}.acc.md`),
    markdown
  );
}

run();
