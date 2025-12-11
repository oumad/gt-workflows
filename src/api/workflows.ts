import { Workflow, WorkflowParams } from '../types';

export async function listWorkflows(): Promise<Workflow[]> {
  try {
    const response = await fetch('/api/workflows/list');
    if (!response.ok) {
      throw new Error('Failed to fetch workflows');
    }
    return await response.json();
  } catch (error) {
    console.error('Error listing workflows:', error);
    // Fallback: try to read from file system via Electron or return empty array
    return [];
  }
}

export async function getWorkflowParams(workflowName: string): Promise<WorkflowParams> {
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}/params`);
    if (!response.ok) {
      throw new Error('Failed to fetch workflow params');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching workflow params:', error);
    throw error;
  }
}

export async function getWorkflowJson(workflowName: string): Promise<any> {
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}/workflow`);
    if (!response.ok) {
      throw new Error('Failed to fetch workflow JSON');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching workflow JSON:', error);
    throw error;
  }
}

export async function saveWorkflowParams(workflowName: string, params: WorkflowParams): Promise<void> {
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}/params`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params, null, 2),
    });
    if (!response.ok) {
      throw new Error('Failed to save workflow params');
    }
  } catch (error) {
    console.error('Error saving workflow params:', error);
    throw error;
  }
}

export async function createWorkflow(workflowName: string, params: WorkflowParams): Promise<void> {
  try {
    const response = await fetch('/api/workflows/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: workflowName, params }),
    });
    if (!response.ok) {
      throw new Error('Failed to create workflow');
    }
  } catch (error) {
    console.error('Error creating workflow:', error);
    throw error;
  }
}

export async function deleteWorkflow(workflowName: string): Promise<void> {
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete workflow');
    }
  } catch (error) {
    console.error('Error deleting workflow:', error);
    throw error;
  }
}

export async function uploadFile(workflowName: string, file: File): Promise<{ filename: string; path: string; relativePath: string }> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}/upload`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload file');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

export async function deleteWorkflowFile(workflowName: string, filename: string): Promise<void> {
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}/file/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete file');
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

