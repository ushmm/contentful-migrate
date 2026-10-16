import { describe, it, expect } from 'vitest'
import {
  removeNullValues,
  rejectEmptyObjects,
  createChangeFieldControl,
  restructureFields,
  restructureContentTypeJson,
  toIdentifier,
  jsonToScript,
  type Control
} from '../jsonToScript'

const TIME_OUT = 5000 // in milliseconds

const assertProps = (actualProps: Record<string, unknown>, expected: Record<string, unknown>): void => {
  Object.keys(actualProps).forEach((prop) => {
    expect(actualProps[prop]).toBe(expected[prop])
  })
}

describe('removeNullValues', () => {
  const fieldValue = [
    { linkMimetypeGroup: ['image'] },
    {
      assetImageDimensions: {
        width: { min: null, max: 200 },
        height: { min: null, max: 40 }
      }
    }
  ]

  const expectedPruned = [
    { linkMimetypeGroup: ['image'] },
    {
      assetImageDimensions: {
        width: { max: 200 },
        height: { max: 40 }
      }
    }
  ]

  it('removes keys with null values from objects', () => {
    const prunedObject = removeNullValues(fieldValue)
    expect(prunedObject).toEqual(expectedPruned)
  })

  it('should do nothing if value is a string or number or array of either', () => {
    const values = [5, '5', Array(5).fill(5), Array(5).fill('5')]
    values.forEach(value => expect(removeNullValues(value)).toEqual(value))
  })

  it('should do nothing if object does not contain any nulls', () => {
    expect(removeNullValues(expectedPruned)).toEqual(expectedPruned)
  })

  it('should do return null if value is null', () => {
    expect(removeNullValues(null)).toEqual(null)
  })
})

describe('rejectEmptyObjects', () => {
  it('rejects empty arrays, empty objects and falsey values', () => {
    const keyValuePair: Array<[string, any]> = [
      ['foo', 'bar'],
      ['horses', ['unicorn, pegasus']],
      ['peru', { animal: 'alpaca' }],
      ['empty array', []],
      ['empty object', {}],
      ['false', false]
    ]
    const actual = keyValuePair.filter(rejectEmptyObjects)
    expect(actual.length).toBe(3)
    actual.forEach((pair, index) => {
      expect(pair).toEqual(keyValuePair[index])
    })
  })
})

describe('createChangeFieldControl', () => {
  it('creates changeFieldControl without settings', () => {
    const itemId = 'myModel'
    const field: Control = { fieldId: 'unicornDestroyer', widgetId: 'number' }

    const changeFieldControl = createChangeFieldControl(itemId, field)
    const expected = 'myModel.changeFieldControl("unicornDestroyer", "builtin", "number");'
    expect(changeFieldControl).toBe(expected)
  })

  it('creates changeFieldControl with settings', () => {
    const itemId = 'myModel'
    const field: Control = {
      fieldId: 'pegasusLauncher',
      widgetId: 'radio',
      settings: { parts: 'button' }
    }
    const changeFieldControl = createChangeFieldControl(itemId, field)
    const expected = 'myModel.changeFieldControl("pegasusLauncher", "builtin", "radio", {\n  parts: "button"\n});'
    expect(changeFieldControl).toBe(expected)
  })
})

describe('restructureFields', () => {
  it('pushes attribute of fields other than id into the key props', () => {
    const field = {
      id: 'tail',
      length: 4,
      color: 'black',
      quality: 'bushy'
    }
    const actual = restructureFields(field)
    expect(actual.id).toBe(field.id)
    assertProps(actual.props, field)
  })
})

describe('restructureContentTypeJson', () => {
  const contentType = {
    sys: { id: 'horse' },
    name: 'horse',
    displayField: 'name',
    description: 'most awesome 4 legged animal',
    fields: [
      { id: 'unicorn', name: 'charlie' },
      { id: 'pegasus', name: 'twilight sparkle' }
    ]
  }
  const actual = restructureContentTypeJson(contentType)

  it('moves sys.id to id', () => {
    expect(actual.id).toBe(contentType.sys.id)
  })

  it('moves name, displayField, description into props', () => {
    assertProps(actual.props, contentType)
  })

  it('maps each field into id and props', () => {
    actual.fields.forEach((field, index) => {
      const expected = contentType.fields[index]
      expect(field.id).toBe(expected.id)
      assertProps(field.props, expected)
    })
  })
})

describe('toIdentifier', () => {
  it('converts hyphenated Contentful ids into camelCase identifiers', () => {
    expect(toIdentifier('blog-post')).toBe('blogPost')
  })
})

describe('jsonToScript', () => {
  const contentType = {
    sys: { id: 'horse' },
    name: 'Horse',
    displayField: 'name',
    description: 'most awesome 4 legged animal',
    fields: [
      { id: 'unicorn', name: 'charlie' },
      { id: 'pegasus', name: 'twilight sparkle' }
    ]
  }

  const editorInterface: Control[] = [
    { fieldId: 'unicornDestroyer', widgetId: 'number' },
    {
      fieldId: 'pegasusLauncher',
      widgetId: 'radio',
      settings: { parts: 'button' }
    }
  ]

  it('generates description, up and down', () => {
    const actual = jsonToScript(contentType, editorInterface)
    expect(actual).toContain('module.exports.description = "Create content model for Horse";')
    expect(actual).toContain('module.exports.up = (migration) => {')
    expect(actual).toContain('module.exports.down = migration => migration.deleteContentType("horse");')
    // Embedded object literals use Standard style: unquoted keys, double-quoted values.
    expect(actual).toContain('parts: "button"')
  }, TIME_OUT)

  it('generates a valid identifier for content type ids that are not valid JS identifiers', () => {
    const actual = jsonToScript({ ...contentType, sys: { id: 'blog-post' } }, [])
    expect(actual).toContain('const blogPost = migration.createContentType(\'blog-post\')')
    // The script must at least be syntactically valid JavaScript
    expect(() => new Function('module', 'migration', actual)).not.toThrow() // eslint-disable-line no-new-func
  }, TIME_OUT)
})
