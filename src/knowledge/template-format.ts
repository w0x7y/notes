export const localDate = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function expandTemplate(
  template: string,
  title: string,
  date = new Date(),
): string {
  const values: Record<string, string> = {
    title,
    date: localDate(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
  return template.replace(
    /\{\{(title|date|time)\}\}/g,
    (match, key: string) => values[key] ?? match,
  );
}
export const starterTemplates = {
  Lecture:
    "# {{title}}\n\n#lecture\n\nDate: {{date}}\n\n## Key ideas\n\n\n## Notes\n\n\n## Questions\n\n- [ ] Review this lecture\n",
  Project:
    '---\nstatus: Todo\npriority: Normal\nsubject: ""\ndue: ""\n---\n\n# {{title}}\n\n#project\n\n## Goal\n\n\n## Next steps\n\n- [ ] Define the first step\n\n## Resources\n\n',
  Assignment:
    '---\nstatus: Todo\npriority: Normal\nsubject: ""\ndue: ""\n---\n\n# {{title}}\n\n#assignment\n\n## Requirements\n\n\n## Work\n\n\n## Before submitting\n\n- [ ] Check the requirements\n',
  Meeting:
    "# {{title}}\n\n#meeting\n\nDate: {{date}}\n\n## Agenda\n\n\n## Decisions\n\n\n## Actions\n\n- [ ] \n",
  Daily:
    "# {{title}}\n\n#daily\n\n## Today\n\n- [ ] \n\n## Notes\n\n\n## Reflection\n\n",
};
