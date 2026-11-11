// The open document's load and save state. One object, shared by the parts
// of the page that load, save, check the disk and switch files, so none of
// them keeps a private copy that can disagree with the rest.
export function createDocumentState() {
  return {
    documentKey: null,
    // The header no longer shows the file name; `Save as new…` still needs it to
    // prefill its field.
    documentName: '',
    diskRevision: null,
    diskText: null,
    diskTimer: null,
    saving: false,
    savePromise: null,
    switchingDocument: false,
    desktopSaving: false,
    savePaused: true,
    // A disk conflict pauses disk writes only: the draft, the suggestions and
    // the assistant keep working on the local copy. savePaused above is the
    // heavier brake — save errors and loading — which still gates everything.
    diskHold: false,
    // Deleting the open file holds autosave only: recreating it 800 ms later
    // would undo the delete behind the writer's back. An explicit save still
    // goes through and brings the file back; Undo restores it at once.
    autosaveHold: false,
    loadingDocument: true,
    editVersion: 0,
  };
}
