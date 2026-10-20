type JsonRecord = Record<string, any>

// Matches identifier-like JSON literal keys so `${key}:` is emitted unquoted.
const BARE_KEY = /^[$A-Z_a-z][$\w]*$/

/** Prints a value with JavaScript Standard-style object literals. */
const formatValue = (value: any, depth: number): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const inner = value.map(item => `${'  '.repeat(depth + 1)}${formatValue(item, depth + 1)}`).join(',\n')
    return `[\n${inner}\n${'  '.repeat(depth)}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const inner = entries.map(([key, entryValue]) => {
      const printedKey = BARE_KEY.test(key) ? key : JSON.stringify(key)
      return `${'  '.repeat(depth + 1)}${printedKey}: ${formatValue(entryValue, depth + 1)}`
    }).join(',\n')
    return `{\n${inner}\n${'  '.repeat(depth)}}`
  }
  return JSON.stringify(value) ?? String(value)
}

export const removeNullValues = (value: any): any => {
  if (value instanceof Array) {
    return value.map(removeNullValues)
  }
  if (value instanceof Object) {
    const prunedObject: JsonRecord = {}
    Object.keys(value).forEach((key) => {
      if (value[key] === null || value[key] === undefined) {
        return
      }
      prunedObject[key] = removeNullValues(value[key])
    })
    return prunedObject
  }
  return value
}

const isValidIdentifier = (name: string): boolean =>
  /^[$A-Z_a-z][$\w]*$/.test(name)

/** Contentful ids only allow letters, digits, `-` and `_`; converts one to a valid JS identifier. */
export const toIdentifier = (name: string): string =>
  name.replace(/[^A-Za-z0-9_]+([A-Za-z0-9_]|$)/g, (_, next: string) => next.toUpperCase())

const createProp = ([key, value]: [string, any]): string =>
  `
  .${key}(${JSON.stringify(removeNullValues(value))})`

export const rejectEmptyObjects = ([, value]: [string, any]): boolean => {
  // null/undefined values would otherwise crash on `value.constructor`.
  const emptyArray = Array.isArray(value) && value.length === 0
  const emptyObject = value !== null && typeof value === 'object' && Object.keys(value).length === 0
  return Boolean(value) && !emptyArray && !emptyObject
}

const createField = (variableName: string, field: { id: string, props: JsonRecord }): string => `
  ${variableName}.createField(${JSON.stringify(field.id)})${Object.entries(field.props).filter(rejectEmptyObjects).map(createProp).join('')};
`

export interface Control {
  fieldId: string
  widgetId: string
  settings?: JsonRecord
}

export const createChangeFieldControl = (
  variableName: string,
  field: Control
): string => {
  const { fieldId, widgetId, settings } = field
  const baseString = `${variableName}.changeFieldControl(${JSON.stringify(fieldId)}, "builtin", ${JSON.stringify(widgetId)}`
  return settings ? `${baseString}, ${formatValue(settings, 0)});` : `${baseString});`
}

interface RestructuredContentType {
  id: string
  props: JsonRecord
  fields: Array<{ id: string, props: JsonRecord }>
}

const createContentType = (
  item: RestructuredContentType,
  editorInterface: Control[]
): string => {
  const variableName = isValidIdentifier(item.id) ? item.id : toIdentifier(item.id)
  // Drop absent props (e.g. no description) so we never emit `.description(undefined)`.
  const filledProps = Object.entries(item.props).filter(([, value]) => value !== null && value !== undefined)
  return `
  const ${variableName} = migration.createContentType('${item.id}')${filledProps.map(createProp).join('')};
  ${item.fields.map(field => createField(variableName, field)).join('')}
  ${editorInterface.map(field => createChangeFieldControl(variableName, field)).join('\n')}
`
}

const createScript = (
  item: RestructuredContentType,
  editorInterface: Control[]
// Content type names can contain quotes, so the description is emitted as a JSON string literal.
): string => `module.exports.description = ${JSON.stringify(`Create content model for ${item.props.name}`)};

module.exports.up = (migration) => {${createContentType(item, editorInterface)}};

module.exports.down = migration => migration.deleteContentType(${JSON.stringify(item.id)});
`

export const restructureFields = <T extends { id: string }>(field: T): { id: string, props: JsonRecord } => {
  const { id, ...props } = field
  return { id, props }
}

export const restructureContentTypeJson = (item: {
  sys: { id: string }
  name?: string
  displayField?: string
  description?: string
  fields: Array<{ id: string } & JsonRecord>
}): RestructuredContentType => ({
  id: item.sys.id,
  props: {
    name: item.name,
    displayField: item.displayField,
    description: item.description
  },
  fields: item.fields.map(restructureFields)
})

export const jsonToScript = (
  contentTypeJson: Parameters<typeof restructureContentTypeJson>[0],
  editorInterface: Control[]
): string => {
  const restructuredJson = restructureContentTypeJson(contentTypeJson)
  return createScript(restructuredJson, editorInterface)
}
