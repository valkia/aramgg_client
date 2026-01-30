import _noop from 'lodash-es/noop';

export default class SourceProto {
  cancelHandlers = {};

  import = _noop;

  setCancelHook = (ns) => (cancel) => {
    this.cancelHandlers[ns] = cancel;
  };

  cancel = () => {
    Object.values(this.cancelHandlers).map((i = _noop) => i());
    return true;
  };
}
