import type { INode } from 'markmap-common';
import {
  deriveOptions,
  type IMarkmapJSONOptions,
  type IMarkmapOptions,
} from 'markmap-view';

export interface IMarkmapVSCodeOptions extends Partial<IMarkmapJSONOptions> {
  /** Assign palette colors by tree depth instead of by branch path. */
  colorByDepth?: boolean;
}

export function deriveVSCodeOptions(
  jsonOptions?: IMarkmapVSCodeOptions,
): Partial<IMarkmapOptions> {
  const options = deriveOptions(jsonOptions);
  if (jsonOptions?.colorByDepth && jsonOptions.color?.length) {
    const colors = jsonOptions.color;
    options.color = (node: INode) =>
      colors[(node.state.depth - 1 + colors.length) % colors.length];
  }
  return options;
}
