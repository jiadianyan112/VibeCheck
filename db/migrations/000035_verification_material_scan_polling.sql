CREATE OR REPLACE FUNCTION private_material.validate_verification_material_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.verification_id<>OLD.verification_id OR NEW.owner_user_id<>OLD.owner_user_id
     OR NEW.storage_key_ciphertext<>OLD.storage_key_ciphertext
     OR NEW.storage_key_nonce<>OLD.storage_key_nonce
     OR NEW.storage_key_auth_tag<>OLD.storage_key_auth_tag
     OR NEW.storage_key_version<>OLD.storage_key_version
     OR NEW.declared_mime<>OLD.declared_mime OR NEW.byte_size<>OLD.byte_size
     OR NEW.checksum_sha256<>OLD.checksum_sha256 OR NEW.idempotency_key<>OLD.idempotency_key
     OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
     OR NEW.upload_expires_at<>OLD.upload_expires_at THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_VERSION_INVALID' USING ERRCODE='23514';
  END IF;
  IF OLD.status='deleted' THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_DELETED_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NOT (
    (OLD.status='prepared' AND NEW.status IN ('uploaded','abandoned','rejected','revoked')) OR
    (OLD.status='uploaded' AND NEW.status IN ('uploaded','scanning','rejected','revoked')) OR
    (OLD.status='scanning' AND NEW.status IN ('scanning','uploaded','ready','rejected','revoked')) OR
    (OLD.status IN ('ready','abandoned','rejected') AND NEW.status IN ('revoked','deleted')) OR
    (OLD.status='revoked' AND NEW.status IN ('revoked','deleted'))
  ) THEN
    RAISE EXCEPTION 'VERIFICATION_MATERIAL_TRANSITION_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private_material.validate_verification_material_mutation() IS
  'Guards immutable verification material identity and permits versioned scanning-to-scanning poll scheduling.';
