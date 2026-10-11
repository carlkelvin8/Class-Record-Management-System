/** Sample record sheet illustrating the purpose of the product. */
export function WorkspaceArt() {
  return (
    <div className="record-preview" aria-hidden="true">
      <div className="record-preview-caption">
        <span>THE CLASS RECORD</span>
        <span>EXAMPLE / 001</span>
      </div>
      <div className="record-preview-title">
        <span>Grade 10 — Mathematics</span>
        <span>Q1</span>
      </div>
      <div className="record-preview-grid">
        <div className="record-preview-row record-preview-head">
          <span>LEARNER</span>
          <span>WW</span>
          <span>PT</span>
          <span>QA</span>
          <span>GRADE</span>
        </div>
        {[
          ["01", "A. Santos", "86", "90", "88", "88"],
          ["02", "M. Reyes", "92", "89", "94", "92"],
          ["03", "J. Cruz", "81", "85", "83", "83"],
          ["04", "L. Garcia", "89", "93", "91", "91"],
        ].map(([number, name, ...scores]) => (
          <div className="record-preview-row" key={number}>
            <span>
              <small>{number}</small>
              {name}
            </span>
            {scores.map((score, i) => (
              <span key={i}>{score}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="record-preview-foot">
        <span>Written work · Performance tasks · Assessment</span>
        <span>Classroom</span>
      </div>
    </div>
  );
}
