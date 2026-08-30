-- Create storage bucket for images pasted into the pipeline Script editor
INSERT INTO storage.buckets (id, name, public)
VALUES ('pipeline-images', 'pipeline-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "pipeline_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'pipeline-images');

-- Allow authenticated users to upload
CREATE POLICY "pipeline_images_auth_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'pipeline-images');
