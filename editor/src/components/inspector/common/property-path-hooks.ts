import * as deepEqual from 'fast-deep-equal'
import * as ObjectPath from 'object-path'
import * as React from 'react'
import { createContext, useContextSelector } from 'use-context-selector'
import { PropertyControls } from 'utopia-api'
import {
  getOpenImportsFromState,
  getOpenUtopiaJSXComponentsFromState,
} from '../../../components/editor/store/editor-state'
import { useEditorState } from '../../../components/editor/store/store-hook'
import {
  calculateMultiPropertyStatusForSelection,
  calculateMultiStringPropertyStatusForSelection,
  ControlStatus,
  ControlStyles,
  getControlStatusFromPropertyStatus,
  getControlStyles,
  PropertyStatus,
} from '../../../components/inspector/common/control-status'
import {
  emptyValues,
  isCSSUnknownFunctionParameters,
  isLayoutPropDetectedInCSS,
  maybePrintCSSValue,
  parseAnyParseableValue,
  ParsedCSSProperties,
  ParsedCSSPropertiesKeys,
  ParsedCSSPropertiesKeysNoLayout,
  ParsedElementProperties,
  ParsedElementPropertiesKeys,
  ParsedProperties,
  ParsedPropertiesKeys,
  ParsedPropertiesValues,
  printCSSValue,
  cssNumber,
} from '../../../components/inspector/common/css-utils'
import {
  createLayoutPropertyPath,
  LayoutProp,
  StyleLayoutProp,
} from '../../../core/layout/layout-helpers-new'
import { findElementAtPath, MetadataUtils } from '../../../core/model/element-metadata-utils'
import { isHTMLComponent, isUtopiaAPIComponent } from '../../../core/model/project-file-utils'
import {
  ParsedPropertyControls,
  parsePropertyControls,
} from '../../../core/property-controls/property-controls-parser'
import {
  filterSpecialProps,
  findMissingDefaults,
  getDefaultPropsFromParsedControls,
  removeIgnored,
  getPropertyControlsForTargetFromEditor,
} from '../../../core/property-controls/property-controls-utils'
import { addUniquely } from '../../../core/shared/array-utils'
import {
  defaultEither,
  Either,
  eitherToMaybe,
  flatMapEither,
  foldEither,
  isRight,
  left,
  mapEither,
} from '../../../core/shared/either'
import {
  getJSXElementNameLastPart,
  getJSXElementNameNoPathName,
  isJSXElement,
  JSXAttributes,
  UtopiaJSXComponent,
  ComputedStyle,
  getJSXAttribute,
} from '../../../core/shared/element-template'
import {
  GetModifiableAttributeResult,
  getModifiableJSXAttributeAtPath,
  jsxSimpleAttributeToValue,
  ModifiableAttribute,
} from '../../../core/shared/jsx-attributes'
import { forEachOptional, optionalMap } from '../../../core/shared/optional-utils'
import type { PropertyPath, TemplatePath } from '../../../core/shared/project-file-types'
import * as PP from '../../../core/shared/property-path'
import * as TP from '../../../core/shared/template-path'
import { fastForEach } from '../../../core/shared/utils'
import { KeepDeepEqualityCall } from '../../../utils/deep-equality'
import {
  keepDeepReferenceEqualityIfPossible,
  useKeepReferenceEqualityIfPossible,
  useKeepShallowReferenceEquality,
} from '../../../utils/react-performance'
import { default as Utils } from '../../../utils/utils'
import { ParseResult } from '../../../utils/value-parser-utils'
import type { ReadonlyRef } from './inspector-utils'

export interface InspectorPropsContextData {
  selectedViews: Array<TemplatePath>
  editedMultiSelectedProps: readonly JSXAttributes[]
  targetPath: readonly string[]
  spiedProps: ReadonlyArray<{ [key: string]: any }>
  computedStyles: ReadonlyArray<ComputedStyle>
}

export interface InspectorCallbackContextData {
  selectedViewsRef: ReadonlyRef<Array<TemplatePath>>
  onSubmitValue: (newValue: any, propertyPath: PropertyPath, transient: boolean) => void
  onUnsetValue: (propertyPath: PropertyPath | Array<PropertyPath>) => void
}

export const InspectorPropsContext = createContext<InspectorPropsContextData>({
  selectedViews: [],
  editedMultiSelectedProps: [],
  targetPath: [],
  spiedProps: [],
  computedStyles: [],
})

export const InspectorCallbackContext = React.createContext<InspectorCallbackContextData>({
  selectedViewsRef: { current: [] },
  onSubmitValue: Utils.NO_OP,
  onUnsetValue: Utils.NO_OP,
})
InspectorCallbackContext.displayName = 'InspectorCallbackContext'

function extractSimpleValueFromMultiSelectAttribute(
  attrs: GetModifiableAttributeResult | undefined,
): Either<string, any> {
  if (attrs == null) {
    return left('Unknown attributes.')
  } else {
    return flatMapEither(jsxSimpleAttributeToValue, attrs)
  }
}

export type MultiselectAtProps<PropertiesToControl extends ParsedPropertiesKeys> = {
  [key in PropertiesToControl]: readonly Either<string, ModifiableAttribute>[]
}

export type MultiselectAtStringProps = {
  [key in string]: readonly Either<string, ModifiableAttribute>[]
}

export interface InspectorInfo<T> {
  value: T
  controlStatus: ControlStatus
  propertyStatus: PropertyStatus
  controlStyles: ControlStyles
  onUnsetValues: () => void
  onSubmitValue: (newTransformedValues: T, transient?: boolean) => void
  onTransientSubmitValue: (newTransformedValues: T) => void
  useSubmitValueFactory: UseSubmitValueFactory<T>
}

function getSpiedValues<P extends string | number>(
  key: P,
  selectedProps: { [keyValue in P]: ReadonlyArray<any> },
): ReadonlyArray<any> {
  if (key in selectedProps) {
    return selectedProps[key]
  } else {
    return []
  }
}

function getComputedStyleValues(
  key: string,
  selectedComputedStyles: { [k: string]: ReadonlyArray<string> },
): ReadonlyArray<string> {
  return selectedComputedStyles[key] ?? []
}

// TODO also memoize me!
export function useInspectorInfoFromMultiselectMultiStyleAttribute<
  PropertiesToControl extends ParsedPropertiesKeys
>(
  multiselectAtProps: MultiselectAtProps<PropertiesToControl>,
  selectedProps: { [key in PropertiesToControl]: ReadonlyArray<any> },
  selectedComputedStyles: { [key in PropertiesToControl]: ReadonlyArray<string> },
): {
  [key in PropertiesToControl]: {
    simpleValues: ReadonlyArray<Either<string, any>>
    rawValues: ReadonlyArray<Either<string, ModifiableAttribute>>
    spiedValues: ReadonlyArray<any>
    computedValues: ReadonlyArray<string>
  }
} {
  const multiselectLength = useContextSelector(InspectorPropsContext, (c) => {
    return c.editedMultiSelectedProps.length
  })

  return React.useMemo(() => {
    const multiselectAtPropsKeys = Object.keys(multiselectAtProps)
    return Utils.mapArrayToDictionary(
      multiselectAtPropsKeys,
      (key) => key as PropertiesToControl,
      (key) => {
        if (multiselectLength === 0) {
          return {
            simpleValues: [left('No value')],
            rawValues: [left('Nothing selected')],
            spiedValues: [undefined],
            computedValues: [],
          }
        }

        const rawValues = multiselectAtProps[key as PropertiesToControl]
        const simpleValues = rawValues.map((rawValue) =>
          extractSimpleValueFromMultiSelectAttribute(rawValue),
        )
        const spiedValues = getSpiedValues(key, selectedProps)
        const computedValues = getComputedStyleValues(key, selectedComputedStyles)

        return {
          simpleValues,
          rawValues,
          spiedValues,
          computedValues,
        }
      },
    )
    // KILLME when `eslint-plugin-react-hooks` is updated to >4.1.2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiselectAtProps, multiselectLength, selectedProps, selectedComputedStyles])
}

// FIXME: copy pasted for component prop section
export function useInspectorInfoFromMultiselectMultiPropAttribute(
  multiselectAtProps: MultiselectAtStringProps,
  selectedProps: { [key in string]: ReadonlyArray<any> },
): {
  [key in string]: {
    simpleValues: ReadonlyArray<Either<string, any>>
    rawValues: ReadonlyArray<Either<string, ModifiableAttribute>>
    spiedValues: ReadonlyArray<any>
  }
} {
  const multiselectLength = useContextSelector(InspectorPropsContext, (c) => {
    return c.editedMultiSelectedProps.length
  })

  return React.useMemo(() => {
    const multiselectAtPropsKeys = Object.keys(multiselectAtProps)
    return Utils.mapArrayToDictionary(
      multiselectAtPropsKeys,
      (key) => key,
      (key) => {
        if (multiselectLength === 0) {
          return {
            simpleValues: [left('No value')],
            rawValues: [left('Nothing selected')],
            spiedValues: [undefined],
          }
        }

        const rawValues = multiselectAtProps[key]
        const simpleValues = rawValues.map((rawValue) =>
          extractSimpleValueFromMultiSelectAttribute(rawValue),
        )
        const spiedValues = getSpiedValues(key, selectedProps)

        return {
          simpleValues,
          rawValues,
          spiedValues,
        }
      },
    )
  }, [multiselectAtProps, multiselectLength, selectedProps])
}

/* eslint-disable react-hooks/rules-of-hooks, react-hooks/exhaustive-deps */
/**
 * DO NOT USE useCallbackFactory outside of inspector-hooks.ts,
 * it is only exported for testing purposes
 *
 * useCallbackFactory is a meta-hook that returns a callback factory hook.
 * As you might see from the disabled linter, this goes a bit against the grain of the Rules of Hooks
 *
 * consult inspector-hooks.spec.ts to see what were the goals / known limitations
 */
export function useCallbackFactory<T>(
  oldValue: T,
  callback: (newValue: T, transient?: boolean) => void,
): <NT>(
  transform: (newValue: NT, old: T) => T,
) => [(newValue: NT) => void, (newValue: NT) => void] {
  return <NT>(transform: (newValue: NT, old: T) => T) => {
    return React.useMemo(() => {
      return [
        (newValue: NT, transient?: boolean) => callback(transform(newValue, oldValue), transient),
        (newValue: NT) => callback(transform(newValue, oldValue), true),
      ]
    }, [transform, oldValue, callback])
  }
}
/* eslint-enable react-hooks/rules-of-hooks, react-hooks/exhaustive-deps */

function elementPathMappingFn<P extends ParsedElementPropertiesKeys>(p: P) {
  return PP.create([p])
}

export function useInspectorElementInfo<P extends ParsedElementPropertiesKeys>(prop: P) {
  type T = ParsedElementProperties[P]
  const transformValue: (parsedValues: ParsedValues<P>) => T = (parsedValues) => parsedValues[prop]

  const untransformValue = (transformedType: T) =>
    ({
      [prop]: transformedType,
    } as Partial<ParsedValues<P>>)

  return useInspectorInfo([prop], transformValue, untransformValue, elementPathMappingFn)
}

export function stylePropPathMappingFn<P extends ParsedCSSPropertiesKeys>(
  p: P,
  target: readonly string[],
) {
  return PP.create([...target, p])
}

export function useInspectorStyleInfo<P extends ParsedCSSPropertiesKeys>(
  prop: P,
  transformValue: (parsedValues: ParsedValues<P>) => ParsedCSSProperties[P] = (parsedValues) =>
    parsedValues[prop],
  untransformValue: (transformedType: ParsedCSSProperties[P]) => Partial<ParsedValues<P>> = (
    transformedType,
  ) =>
    ({
      [prop]: transformedType,
    } as Partial<ParsedValues<P>>),
) {
  return useInspectorInfo([prop], transformValue, untransformValue, stylePropPathMappingFn)
}

export function useInspectorContext() {
  const { onSubmitValue, onUnsetValue, selectedViewsRef } = React.useContext(
    InspectorCallbackContext,
  )
  return React.useMemo(() => {
    return {
      onContextSubmitValue: onSubmitValue,
      onContextUnsetValue: onUnsetValue,
      selectedViewsRef: selectedViewsRef,
    }
  }, [onSubmitValue, onUnsetValue, selectedViewsRef])
}

function parseFinalValue<PropertiesToControl extends ParsedPropertiesKeys>(
  property: PropertiesToControl,
  simpleValue: Either<string, any>,
  rawValue: Either<string, ModifiableAttribute>,
  spiedValue: any,
  computedValue: string | undefined,
): {
  finalValue: ParsedPropertiesValues
  isUnknown: boolean
  usesComputedFallback: boolean
} {
  const simpleValueAsMaybe = eitherToMaybe(simpleValue)
  const rawValueAsMaybe = eitherToMaybe(rawValue)

  const parsedValue = parseAnyParseableValue(property, simpleValueAsMaybe, rawValueAsMaybe)
  const parsedSpiedValue = parseAnyParseableValue(property, spiedValue, null)
  const parsedComputedValue = parseAnyParseableValue(property, computedValue, null)
  if (isRight(parsedValue)) {
    return {
      finalValue: parsedValue.value,
      isUnknown: isCSSUnknownFunctionParameters(parsedValue.value),
      usesComputedFallback: false,
    }
  } else if (isRight(parsedSpiedValue)) {
    return {
      finalValue: parsedSpiedValue.value,
      isUnknown: simpleValueAsMaybe != null,
      usesComputedFallback: false,
    }
  } else if (isRight(parsedComputedValue)) {
    return {
      finalValue: parsedComputedValue.value,
      isUnknown: simpleValueAsMaybe != null,
      usesComputedFallback: true,
    }
  } else {
    return {
      finalValue: emptyValues[property],
      isUnknown: simpleValueAsMaybe != null,
      usesComputedFallback: false,
    }
  }
}

export type ParsedValues<P extends ParsedPropertiesKeys> = { [key in P]: ParsedProperties[key] }

export type SubmitValueFactoryReturn<T> = [(newValue: T) => void, (newValue: T) => void]

/**
 * @returns [onSubmitValue, onTransientSubmitValue]
 */
export type UseSubmitValueFactory<T> = <NewType>(
  transform: (newValue: NewType, oldValue: T) => T,
) => SubmitValueFactoryReturn<NewType>

export type OnUnsetValues = () => void

function useMemoizedPropKeys<T>(propKeys: Array<T>): Array<T> {
  return useKeepShallowReferenceEquality(propKeys)
}

export type PathMappingFn<P> = (propKey: P, targetPath: readonly string[]) => PropertyPath

export type TransformInspectorInfo<P extends ParsedPropertiesKeys, T = ParsedProperties[P]> = (
  parsedValues: ParsedValues<P>,
) => T
export type UntransformInspectorInfo<P extends ParsedPropertiesKeys, T = ParsedProperties[P]> = (
  transformedType: T,
) => Partial<ParsedValues<P>>

export function useInspectorInfo<P extends ParsedPropertiesKeys, T = ParsedProperties[P]>(
  propKeysIn: Array<P>,
  transformValue: TransformInspectorInfo<P, T>,
  untransformValue: UntransformInspectorInfo<P, T>,
  pathMappingFn: PathMappingFn<P>,
): InspectorInfo<T> {
  const propKeys = useMemoizedPropKeys(propKeysIn)
  const multiselectAtProps: MultiselectAtProps<P> = useKeepReferenceEqualityIfPossible(
    useContextSelector(
      InspectorPropsContext,
      (contextData) => {
        const keyFn = (propKey: P) => propKey
        const mapFn = (propKey: P) =>
          contextData.editedMultiSelectedProps.map((props) => {
            return getModifiableJSXAttributeAtPath(
              props,
              pathMappingFn(propKey, contextData.targetPath),
            )
          })
        return Utils.mapArrayToDictionary(propKeys, keyFn, mapFn)
      },
      deepEqual,
    ),
  )

  const selectedProps = useKeepReferenceEqualityIfPossible(
    useContextSelector(
      InspectorPropsContext,
      (contextData) => {
        const keyFn = (propKey: P) => propKey
        const mapFn = (propKey: P) => {
          return contextData.spiedProps.map((props) => {
            return ObjectPath.get(
              props,
              PP.getElements(pathMappingFn(propKey, contextData.targetPath)),
            )
          })
        }
        return Utils.mapArrayToDictionary(propKeys, keyFn, mapFn)
      },
      deepEqual,
    ),
  )

  const selectedComputedStyles = useKeepReferenceEqualityIfPossible(
    useContextSelector(
      InspectorPropsContext,
      (contextData) => {
        const keyFn = (propKey: P) => propKey
        const mapFn = (propKey: P): string[] => {
          const path = PP.getElements(pathMappingFn(propKey, contextData.targetPath))
          const isStylePath = path[0] === 'style' || path[0] === 'css'
          if (isStylePath && path.length === 2) {
            return contextData.computedStyles.map((computedStyle) => {
              return ObjectPath.get(computedStyle, path[1])
            })
          } else {
            return []
          }
        }
        return Utils.mapArrayToDictionary(propKeys, keyFn, mapFn)
      },
      deepEqual,
    ),
  )

  const simpleAndRawValues = useInspectorInfoFromMultiselectMultiStyleAttribute(
    multiselectAtProps,
    selectedProps,
    selectedComputedStyles,
  )

  const propertyStatus = calculateMultiPropertyStatusForSelection(
    multiselectAtProps,
    simpleAndRawValues,
  )

  let isUnknown = false
  const values = Utils.mapArrayToDictionary(
    propKeys,
    (propKey) => propKey,
    (propKey) => {
      const { simpleValues, rawValues, spiedValues, computedValues } = simpleAndRawValues[propKey]
      if (propertyStatus.identical) {
        const simpleValue: Either<string, any> = Utils.defaultIfNull(
          left('Simple value missing'),
          simpleValues[0],
        )
        const rawValue: Either<string, ModifiableAttribute> = Utils.defaultIfNull(
          left('Raw value missing'),
          rawValues[0],
        )
        const spiedValue: any = spiedValues[0]
        const computedValue = computedValues[0]
        const { finalValue, isUnknown: pathIsUnknown, usesComputedFallback } = parseFinalValue(
          propKey,
          simpleValue,
          rawValue,
          spiedValue,
          computedValue,
        )
        isUnknown = isUnknown || pathIsUnknown
        // setting the status to detected because it uses the fallback value
        propertyStatus.detected = usesComputedFallback
        return finalValue
      } else {
        let firstFinalValue: ParsedPropertiesValues
        simpleValues.forEach((simpleValue, i) => {
          const rawValue: Either<string, ModifiableAttribute> = Utils.defaultIfNull(
            left('Raw value missing'),
            rawValues[i],
          )
          const spiedValue: any = spiedValues[i]
          const computedValue = computedValues[i]
          const { finalValue, isUnknown: pathIsUnknown, usesComputedFallback } = parseFinalValue(
            propKey,
            simpleValue,
            rawValue,
            spiedValue,
            computedValue,
          )
          if (i === 0) {
            firstFinalValue = finalValue
          }
          isUnknown = isUnknown || pathIsUnknown
          // setting the status to detected because it uses the fallback value
          propertyStatus.detected = propertyStatus.detected || usesComputedFallback
        })
        return firstFinalValue
      }
    },
  ) as ParsedValues<P>

  let controlStatus: ControlStatus = getControlStatusFromPropertyStatus(propertyStatus)
  if (isUnknown) {
    if (controlStatus === 'simple') {
      controlStatus = 'simple-unknown-css'
    } else if (
      controlStatus === 'multiselect-identical-simple' ||
      controlStatus === 'multiselect-identical-unset' ||
      controlStatus === 'multiselect-mixed-simple-or-unset'
    ) {
      controlStatus = 'multiselect-simple-unknown-css'
    }
  }

  const {
    onContextSubmitValue: onSingleSubmitValue,
    onContextUnsetValue: onUnsetValue,
  } = useInspectorContext()

  const target = useKeepReferenceEqualityIfPossible(
    useContextSelector(InspectorPropsContext, (contextData) => contextData.targetPath, deepEqual),
  )
  const onUnsetValues = React.useCallback(() => {
    onUnsetValue(propKeys.map((propKey) => pathMappingFn(propKey, target)))
  }, [onUnsetValue, propKeys, pathMappingFn, target])

  const transformedValue = transformValue(values)
  const onSubmitValue: (newValue: T, transient?: boolean) => void = React.useCallback(
    (newValue, transient = false) => {
      const untransformedValue = untransformValue(newValue)
      propKeys.forEach((propKey) => {
        const propertyPath = pathMappingFn(propKey, target)
        const valueToPrint = untransformedValue[propKey]
        if (valueToPrint != null) {
          const printedProperty = printCSSValue(propKey, valueToPrint as ParsedProperties[P])
          onSingleSubmitValue(printedProperty, propertyPath, transient)
        } else {
          onUnsetValue(propertyPath)
        }
      })
    },
    // KILLME when `eslint-plugin-react-hooks` is updated to >4.1.2
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSingleSubmitValue, untransformValue, propKeys, onUnsetValue, pathMappingFn, target],
  )

  const onTransientSubmitValue: (newValue: T) => void = React.useCallback(
    (newValue) => onSubmitValue(newValue, true),
    [onSubmitValue],
  )

  const useSubmitValueFactory = useCallbackFactory(transformedValue, onSubmitValue)

  const controlStyles = getControlStyles(controlStatus)
  const propertyStatusToReturn = useKeepReferenceEqualityIfPossible(propertyStatus)

  return {
    value: transformedValue,
    controlStatus,
    propertyStatus: propertyStatusToReturn,
    controlStyles,
    onSubmitValue,
    onTransientSubmitValue,
    onUnsetValues,
    useSubmitValueFactory,
  }
}

// TODO: Warning, this is just copy pasted code from useInspectorInfo. We needed a hook which
// works for any kind of prop (and not just css props). To properly do that we would need to refactor
// useInspectorInfo, but for now this is just a copy pasted version with less strict types and
// a default parser (which does nothing)
// FIXME: copy pasted for component prop section
export function useInspectorInfoSimpleUntyped(
  propertyPaths: ReadonlyArray<PropertyPath>,
  transformValue: (parsedValues: any) => any,
  untransformValue: (transformedType: any) => any,
): InspectorInfo<any> {
  const multiselectAtProps: MultiselectAtStringProps = useKeepReferenceEqualityIfPossible(
    useContextSelector(
      InspectorPropsContext,
      (contextData) => {
        const pathArray = (propertyPath: PropertyPath) =>
          propertyPath.propertyElements[propertyPath.propertyElements.length - 1]
        const keyFn = (propertyPath: PropertyPath) =>
          contextData.editedMultiSelectedProps.map((props) => {
            return getModifiableJSXAttributeAtPath(props, propertyPath)
          })
        return Utils.mapArrayToDictionary(propertyPaths, pathArray, keyFn)
      },
      deepEqual,
    ),
  )

  const selectedProps = useKeepReferenceEqualityIfPossible(
    useContextSelector(
      InspectorPropsContext,
      (contextData) => {
        const keyFn = (propPath: PropertyPath) => PP.lastPart(propPath)
        const mapFn = (propPath: PropertyPath) => {
          return contextData.spiedProps.map((props) => {
            return ObjectPath.get(props, PP.getElements(propPath))
          })
        }
        return Utils.mapArrayToDictionary(propertyPaths, keyFn, mapFn)
      },
      deepEqual,
    ),
  )

  const simpleAndRawValues = useInspectorInfoFromMultiselectMultiPropAttribute(
    multiselectAtProps,
    selectedProps,
  )

  const propertyStatus = calculateMultiStringPropertyStatusForSelection(
    multiselectAtProps,
    simpleAndRawValues,
  )

  const values = Utils.mapArrayToDictionary(
    propertyPaths,
    (propertyPath) => propertyPath.propertyElements[propertyPath.propertyElements.length - 1],
    (propertyPath) => {
      const property = propertyPath.propertyElements[propertyPath.propertyElements.length - 1]
      const { simpleValues, spiedValues, rawValues } = simpleAndRawValues[property]
      const simpleValue = optionalMap(eitherToMaybe, simpleValues[0])
      if (spiedValues.length > 0) {
        return spiedValues[0]
      } else if (simpleValue != null) {
        return simpleValue
      } else {
        return optionalMap(eitherToMaybe, rawValues[0])
      }
    },
  )

  let controlStatus: ControlStatus = getControlStatusFromPropertyStatus(propertyStatus)

  const {
    onContextSubmitValue: onSingleSubmitValue,
    onContextUnsetValue: onSingleUnsetValue,
  } = useInspectorContext()

  const onUnsetValues = React.useCallback(() => {
    for (const propertyPath of propertyPaths) {
      onSingleUnsetValue(propertyPath)
    }
  }, [onSingleUnsetValue, propertyPaths])

  const transformedValue = transformValue(values)
  const onSubmitValue = React.useCallback(
    (newValue: any, transient = false) => {
      const untransformedValue = untransformValue(newValue)
      const submitValue = (<Key extends string>(path: {
        propertyElements: ['style', Key] | ['layout', Key] | [Key]
      }) => {
        const property = path.propertyElements[path.propertyElements.length - 1] as Key
        if (property in untransformedValue) {
          const propertyToPrint = untransformedValue[property]
          const printedProperty = maybePrintCSSValue(property, propertyToPrint)
          onSingleSubmitValue(printedProperty, path, transient)
        } else {
          onSingleUnsetValue(path)
        }
      }) as (path: PropertyPath) => void
      propertyPaths.forEach(submitValue)
    },
    [onSingleSubmitValue, untransformValue, propertyPaths, onSingleUnsetValue],
  )

  const onTransientSubmitValue = React.useCallback((newValue) => onSubmitValue(newValue, true), [
    onSubmitValue,
  ])

  const useSubmitValueFactory = useCallbackFactory(transformedValue, onSubmitValue)

  const controlStyles = getControlStyles(controlStatus)
  const propertyStatusToReturn = useKeepReferenceEqualityIfPossible(propertyStatus)

  return {
    value: transformedValue,
    controlStatus,
    propertyStatus: propertyStatusToReturn,
    controlStyles,
    onSubmitValue,
    onTransientSubmitValue,
    onUnsetValues,
    useSubmitValueFactory,
  }
}

export function useInspectorLayoutInfo<P extends LayoutProp | StyleLayoutProp>(
  property: P,
): InspectorInfo<ParsedProperties[P]> {
  function transformValue(parsedValues: ParsedValues<P>): ParsedProperties[P] {
    return parsedValues[property]
  }
  function untransformValue(transformedType: ParsedProperties[P]): Partial<ParsedValues<P>> {
    return { [property]: transformedType } as Partial<ParsedValues<P>>
  }

  let inspectorInfo = useInspectorInfo(
    [property],
    transformValue,
    untransformValue,
    createLayoutPropertyPath,
  )
  return inspectorInfo
}

export function useIsSubSectionVisible(sectionName: string): boolean {
  const selectedViews = useRefSelectedViews()

  return useEditorState((store) => {
    const imports = getOpenImportsFromState(store.editor)
    const rootComponents = getOpenUtopiaJSXComponentsFromState(store.editor)
    const types = selectedViews.current.map((view) => {
      if (TP.isScenePath(view)) {
        return 'scene'
      }

      const element = findElementAtPath(view, rootComponents)
      if (element == null) {
        return null
      } else if (isJSXElement(element)) {
        if (isUtopiaAPIComponent(element.name, imports)) {
          return getJSXElementNameLastPart(element.name).toString().toLowerCase()
        } else if (isHTMLComponent(element.name, imports)) {
          return element.name.baseVariable
        } else {
          return null
        }
      } else {
        return null
      }
    })
    return types.every((type) => {
      const allowedTypes = StyleSubSectionForType[sectionName]
      if (allowedTypes == null) {
        return false
      } else {
        if (typeof allowedTypes === 'boolean') {
          return allowedTypes
        } else {
          return allowedTypes.find((t) => t === type)
        }
      }
    })
  }, 'useIsSubSectionVisible')
}

const StyleSubSectionForType: { [key: string]: string[] | boolean } = {
  text: ['div', 'span', 'text'],
  textShadow: ['div', 'span', 'text'],
  shadow: true,
  border: true,
  opacity: true,
  background: true,
  img: ['img'],
  transform: true,
}

export function useSelectedPropertyControls(
  includeIgnored: boolean,
): ParseResult<ParsedPropertyControls> {
  const selectedViews = useRefSelectedViews()

  const propertyControls = useEditorState((store) => {
    const { codeResultCache } = store.editor

    let selectedPropertyControls: PropertyControls | null = {}
    if (codeResultCache != null) {
      Utils.fastForEach(selectedViews.current, (path) => {
        // TODO multiselect
        // TODO use getPropertyControlsForTarget and reselect selectors
        selectedPropertyControls = getPropertyControlsForTargetFromEditor(path, store.editor) ?? {}
      })
    }

    return selectedPropertyControls
  }, 'useSelectedPropertyControls')

  // Strip ignored property controls here.
  const parsed = parsePropertyControls(propertyControls)
  if (includeIgnored) {
    return parsed
  } else {
    return mapEither(removeIgnored, parsed)
  }
}

export function useUsedPropsWithoutControls(): Array<string> {
  const parsedPropertyControls = useSelectedPropertyControls(true)

  const selectedViews = useRefSelectedViews()

  const selectedComponents = useEditorState((store) => {
    const { jsxMetadataKILLME } = store.editor
    const rootComponents = getOpenUtopiaJSXComponentsFromState(store.editor)
    let components: Array<UtopiaJSXComponent> = []
    const pushComponent = (component: UtopiaJSXComponent) => components.push(component)
    fastForEach(selectedViews.current, (path) => {
      if (TP.isScenePath(path)) {
        const scene = MetadataUtils.findSceneByTemplatePath(jsxMetadataKILLME.components, path)
        if (scene != null) {
          const underlyingComponent = rootComponents.find(
            (component) => component.name === scene.component,
          )
          forEachOptional(pushComponent, underlyingComponent)
        }
      } else {
        const element = findElementAtPath(path, rootComponents)
        if (element != null && isJSXElement(element)) {
          const noPathName = getJSXElementNameNoPathName(element.name)
          const underlyingComponent = rootComponents.find(
            (component) => component.name === noPathName,
          )
          forEachOptional(pushComponent, underlyingComponent)
        }
      }
    })

    return components
  }, 'useUsedPropsWithoutControls')

  return foldEither(
    (_) => [],
    (propertyControls: ParsedPropertyControls) => {
      const propertiesWithControls = Object.keys(propertyControls)
      let propertiesWithoutControls: Array<string> = []
      fastForEach(selectedComponents, (component) => {
        if (isJSXElement(component.rootElement)) {
          const propsUsed = filterSpecialProps(component.propsUsed)
          fastForEach(propsUsed, (propUsed) => {
            if (!propertiesWithControls.includes(propUsed)) {
              propertiesWithoutControls = addUniquely(propertiesWithoutControls, propUsed)
            }
          })
        }
      })

      return propertiesWithoutControls
    },
    parsedPropertyControls,
  )
}

export function useUsedPropsWithoutDefaults(): Array<string> {
  const parsedPropertyControls = useSelectedPropertyControls(false)

  const selectedViews = useRefSelectedViews()

  const selectedComponentProps = useEditorState((store) => {
    const { jsxMetadataKILLME } = store.editor
    const rootComponents = getOpenUtopiaJSXComponentsFromState(store.editor)
    let propsUsed: Array<string> = []
    const pushPropsForComponent = (component: UtopiaJSXComponent) =>
      propsUsed.push(...component.propsUsed)
    fastForEach(selectedViews.current, (path) => {
      if (TP.isScenePath(path)) {
        const scene = MetadataUtils.findSceneByTemplatePath(jsxMetadataKILLME.components, path)
        if (scene != null) {
          const underlyingComponent = rootComponents.find(
            (component) => component.name === scene.component,
          )
          forEachOptional(pushPropsForComponent, underlyingComponent)
        }
      } else {
        const element = findElementAtPath(path, rootComponents)
        if (element != null && isJSXElement(element)) {
          const noPathName = getJSXElementNameNoPathName(element.name)
          const underlyingComponent = rootComponents.find(
            (component) => component.name === noPathName,
          )
          forEachOptional(pushPropsForComponent, underlyingComponent)
        }
      }
    })
    return propsUsed
  }, 'useUsedPropsWithoutDefaults')

  const defaultProps = getDefaultPropsFromParsedControls(parsedPropertyControls)
  return findMissingDefaults(selectedComponentProps, defaultProps)
}

export function useInspectorWarningStatus(): boolean {
  const selectedViews = useSelectedViews()

  return useEditorState((store) => {
    const rootComponents = getOpenUtopiaJSXComponentsFromState(store.editor)
    let hasLayoutInCSSProp = false
    Utils.fastForEach(selectedViews, (view) => {
      if (TP.isScenePath(view) || hasLayoutInCSSProp) {
        return
      }

      const element = findElementAtPath(view, rootComponents)
      if (element == null || !isJSXElement(element)) {
        return
      } else {
        const cssAttribute = getJSXAttribute(element.props, 'css')
        if (cssAttribute == null) {
          return
        } else {
          const cssProps = Utils.defaultIfNull(
            {},
            eitherToMaybe(jsxSimpleAttributeToValue(cssAttribute)),
          )
          hasLayoutInCSSProp = isLayoutPropDetectedInCSS(cssProps)
        }
      }
    })
    return hasLayoutInCSSProp
  }, 'useInspectorWarningStatus')
}

export function useSelectedViews() {
  const selectedViews = useContextSelector(
    InspectorPropsContext,
    (context) => context.selectedViews,
  )
  return selectedViews
}

export function useRefSelectedViews() {
  const { selectedViewsRef } = React.useContext(InspectorCallbackContext)
  return selectedViewsRef
}
