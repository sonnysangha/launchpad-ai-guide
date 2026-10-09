import type { Task, Workflow } from "./contracts";

// Shared fictional templates for saved tasks and unsaved previews.
// This module has no server or browser dependencies.
export const sampleTaskTemplates: Record<Workflow, readonly Omit<Task, "id">[]> = {
  client_delivery: [
    { title: "Capture the project brief", stage: "Brief", description: "Write the goal, scope, and what a successful delivery looks like.", tag: "Strategy" },
    { title: "Gather brand references", stage: "Brief", description: "Collect the visual direction for this fictional client project.", tag: "Creative" },
    { title: "Create the first concept", stage: "Build", description: "Turn the agreed brief into a first working draft.", tag: "Design" },
    { title: "Build the core deliverable", stage: "Build", description: "Develop the chosen concept into a reviewable version.", tag: "Production" },
    { title: "Review with the project team", stage: "Review", description: "Collect feedback and check the work against the brief.", tag: "Feedback" },
    { title: "Prepare the handoff", stage: "Handoff", description: "Package the final files and a short guide to what comes next.", tag: "Delivery" },
  ],
  campaign: [
    { title: "Define the campaign goal", stage: "Brief", description: "Capture the audience, message, and one measurable outcome.", tag: "Strategy" },
    { title: "Collect creative references", stage: "Brief", description: "Add a few visual and copy directions for this fictional campaign.", tag: "Creative" },
    { title: "Draft the hero creative", stage: "Build", description: "Prepare the first concept using the agreed direction.", tag: "Creative" },
    { title: "Write launch copy", stage: "Build", description: "Draft a headline and supporting campaign message.", tag: "Copy" },
    { title: "Review the campaign kit", stage: "Review", description: "Check the concept against the brief before handoff.", tag: "Feedback" },
    { title: "Prepare the launch checklist", stage: "Handoff", description: "Collect final assets and document the next steps.", tag: "Delivery" },
  ],
};

export function getPreviewTasks(workflow: Workflow): Task[] {
  return sampleTaskTemplates[workflow].map((task, index) => ({ ...task, id: `preview-${workflow}-${index + 1}` }));
}

