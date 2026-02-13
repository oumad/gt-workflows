import { Workflow, WorkflowParams } from '../types';
import { fetchWithAuth } from '../utils/auth';

// Request deduplication cache
const pendingRequests = new Map<string, Promise<any>>();

export async function listWorkflows(): Promise<Workflow[]> {
  const cacheKey = 'listWorkflows';
  
  // If there's already a pending request, return it
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  const request = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetchWithAuth('/api/workflows/list', {
        signal: controller.signal,
        // Prevent browser from retrying automatically
        cache: 'no-store',
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // If backend returns 503, it's unavailable - don't retry
        if (response.status === 503) {
          console.warn('Backend server unavailable');
          return [];
        }
        throw new Error(`Failed to fetch workflows: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      // Don't log AbortError or network errors repeatedly - they're expected when backend is down
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          // Timeout - backend likely not responding
          return [];
        }
        // Network errors (ENOBUFS, ECONNREFUSED, etc.) - backend unavailable
        if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
          return [];
        }
      }
      // Only log unexpected errors
      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.error('Error listing workflows:', error);
      }
      // Return empty array on error instead of throwing
      return [];
    } finally {
      // Remove from pending requests after completion
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, request);
  return request;
}

export async function getWorkflowParams(workflowName: string): Promise<WorkflowParams> {
  try {
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/params`);
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
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/workflow`);
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
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/params`, {
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
    const response = await fetchWithAuth('/api/workflows/create', {
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
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}`, {
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

export async function duplicateWorkflow(workflowName: string, newName: string): Promise<void> {
  try {
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ newName }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to duplicate workflow' }));
      throw new Error(errorData.error || 'Failed to duplicate workflow');
    }
  } catch (error) {
    console.error('Error duplicating workflow:', error);
    throw error;
  }
}

export async function uploadFile(workflowName: string, file: File): Promise<{ filename: string; path: string; relativePath: string }> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/upload`, {
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
    const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/file/${encodeURIComponent(filename)}`, {
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

export async function downloadWorkflow(workflowName: string): Promise<void> {
  try {
    const downloadUrl = `/api/workflows/${encodeURIComponent(workflowName)}/download`;
    console.log('Downloading workflow from:', downloadUrl);
    
    const response = await fetchWithAuth(downloadUrl);
    console.log('Response status:', response.status, response.statusText);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      // Try to read error message from response
      let errorMessage = `Failed to download workflow (${response.status} ${response.statusText})`;
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          console.error('Error response:', errorData);
        } else {
          // Try to read as text if not JSON
          const errorText = await response.text();
          if (errorText) {
            console.error('Error response text:', errorText);
            errorMessage = errorText || errorMessage;
          }
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError);
        // If response is not JSON, use status text
        errorMessage = response.statusText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    // Check if response is actually a zip file
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('application/zip') && !contentType.includes('application/octet-stream')) {
      // Might be an error JSON response
      try {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Invalid response format');
      } catch {
        throw new Error('Server returned invalid response format');
      }
    }
    
    // Get the blob from the response
    const blob = await response.blob();
    
    // Verify blob is not empty
    if (blob.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    // Create a download link and trigger it
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflowName}.zip`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('Error downloading workflow:', error);
    throw error;
  }
}

