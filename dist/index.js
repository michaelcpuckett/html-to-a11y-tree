"use strict"; function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; } function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } }var _process = require('process'); var _process2 = _interopRequireDefault(_process);
var _fs = require('fs'); var _fs2 = _interopRequireDefault(_fs);
var _path = require('path'); var _path2 = _interopRequireDefault(_path);
var _htmldomparser = require('html-dom-parser'); var _htmldomparser2 = _interopRequireDefault(_htmldomparser);






var _ariaToHtmlMapping = require('./ariaToHtmlMapping');

var _ariaRolesWithPresentationalChildren = require('./ariaRolesWithPresentationalChildren');
var _ariaRolesWithoutAriaLabelSupport = require('./ariaRolesWithoutAriaLabelSupport');
var _landmarkRoles = require('./landmarkRoles');

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
];






function guardIsRole(value) {
  return (
    typeof value === "string" && Object.keys(_ariaToHtmlMapping.ariaToHtmlMapping).includes(value)
  );
}

const filterOutCommentsAndDirectives = (node) => {
  return node.type !== "directive" && node.type !== "comment";
};

function guardIsParserElement(value) {
  return guardIsParserNode(value) && value.type === "tag";
}

function guardIsParserText(value) {
  return guardIsParserNode(value) && value.type === "text";
}

function guardIsParserNode(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    ["tag", "text"].includes(value.type)
  );
}

















function getChildNodes(children) {
  const childParserNodes = children.filter(guardIsParserNode);
  return childParserNodes.map(convertParsedNode);
}

class AccElement  {
  
  
  
  
  
  

  constructor(
    tagName,
    attributes,
    children
  ) {;AccElement.prototype.__init.call(this);
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = children;
    this.type = "AccElement";
    this.role = this.getRoleFromTagName();
    this.accName = this.getAccessibleName();
  }

  getRoleFromString(tagName) {
    const [role] =
      _nullishCoalesce(Object.entries(_ariaToHtmlMapping.ariaToHtmlMapping).find(([, value]) =>
        value.includes(tagName)
      ), () => ( []));

    return role;
  }

  getRoleFromTagName() {
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

  getAccessibleName() {
    if (!_ariaRolesWithoutAriaLabelSupport.ariaRolesWithoutAriaLabelSupport.includes(this.role)) {
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

    if (_ariaRolesWithPresentationalChildren.ariaRolesWithPresentationalChildren.includes(this.role)) {
      const innerText = this.children
        .map(this.getChildTextNodes)
        .flat()
        .map((child) => child.data)
        .join(" ");

      return innerText;
    }

    return "";
  }

  __init() {this.getChildTextNodes = (node) => {
    if (guardIsAccText(node)) {
      return [node];
    }

    if (guardIsAccElement(node)) {
      return node.children.map(this.getChildTextNodes).flat();
    }

    throw new Error("Unknown node type");
  }}
}

class AccText  {
  
  

  constructor(data) {
    this.data = data;
    this.type = "AccText";
  }
}

const convertParsedNode = (node) => {
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

function guardIsAccElement(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "AccElement"
  );
}

function guardIsAccText(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "AccText"
  );
}

function guardIsAccNode(value) {
  return guardIsAccElement(value) || guardIsAccText(value);
}

function assertIsAccNode(value) {
  if (!guardIsAccNode(value)) {
    throw new Error("Expected value to be an IAccNode");
  }

  return value;
}

function filterOutEmptyRoleNodesFromTree(node) {
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

function flattenNodes(nodes) {
  return nodes.reduce((accumulator, node) => {
    if (guardIsAccElement(node)) {
      accumulator.push(node, ...flattenNodes(node.children));
    } else {
      accumulator.push(node);
    }

    return accumulator;
  }, [] );
}

function renderToMarkdown(nodes) {
  function getLabelledByReferenceText(labelledBy) {
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
    node,
    level = 0,
    parentPrefix = ""
  ) {
    const indent = (level) => "  ".repeat(level);

    if (guardIsAccElement(node)) {
      const listItemLevel = node.role === "list" ? level + 1 : level;

      const isContainer = _landmarkRoles.containerRoles.includes(node.role);
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

      const prefixes = {
        listitem: listitemPrefix,
        heading: headingPrefix,
      };

      const prefix = `${_nullishCoalesce(prefixes[node.role], () => ( ""))}`;

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

function renderToJsx(nodes) {
  function renderNodeToJsx(node, level = 0) {
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

async function getAccessibilityTree(url, debug = false) {
  const htmlFile = await fetch(url).then((response) => response.text());

  if (debug) {
    _fs2.default.writeFileSync(
      _path2.default.resolve("./results/", `${new URL(url).hostname}.html`),
      htmlFile
    );
  }

  const parsedDocument = _htmldomparser2.default.call(void 0, htmlFile, {
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

function isValidFormat(format) {
  return ["json", "jsx", "md"].includes(format);
}

async function cli() {
  const [url, format, debug] = _process2.default.argv.slice(2);

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
    _fs2.default.writeFileSync(
      _path2.default.resolve("./results/", `${new URL(url).hostname}.acc.json`),
      JSON.stringify(accessibilityTree, null, 2)
    );

    console.log(JSON.stringify(accessibilityTree, null, 2));
  }

  if (format === "jsx") {
    const jsx = renderToJsx(accessibilityTree);

    _fs2.default.writeFileSync(
      _path2.default.resolve("./results/", `${new URL(url).hostname}.acc.jsx`),
      jsx
    );

    return jsx;
  }

  if (format === "md") {
    const markdown = renderToMarkdown(accessibilityTree);

    _fs2.default.writeFileSync(
      _path2.default.resolve("./results/", `${new URL(url).hostname}.acc.md`),
      markdown
    );

    return markdown;
  }
}

cli();
